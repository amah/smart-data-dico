/**
 * Direct OpenAI-compatible API client for tool calling.
 *
 * Bypasses Vercel AI SDK which has compatibility issues with some providers
 * (e.g., kimi-k2.5 via Mammouth AI — the SDK drops tool call arguments
 * from streaming responses due to non-standard tool call ID formats).
 *
 * This client makes direct HTTP calls and parses responses manually.
 */

import { logger } from './logger.js';

interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

interface DirectClientConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export class AbortError extends Error {
  constructor(message: string = 'Aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

export interface DirectClientUsage {
  inputTokens: number;
  outputTokens: number;
}

export async function callWithTools(
  config: DirectClientConfig,
  messages: Message[],
  tools: ToolDef[],
  // toolCallId is passed as a 3rd arg (backward-compatible) so the executor
  // can target the server-side approval gate for that specific call.
  executeToolFn: (name: string, args: any, toolCallId?: string) => Promise<any>,
  maxSteps: number = 10,
  onEvent?: (event: any) => void,
  signal?: AbortSignal,
): Promise<{
  text: string;
  toolCalls: Array<{ name: string; input: any; output: any }>;
  aborted?: boolean;
  usage: DirectClientUsage;
  /**
   * True only when the agentic loop exhausted its `maxSteps` budget (#192)
   * rather than the model naturally finishing (hitting `break`). When set, the
   * returned `text` is a model-generated "summary turn" produced by one final
   * tool-less call, and the caller should surface a visible step-limit notice.
   */
  stoppedAtStepLimit: boolean;
}> {
  const currentMessages = [...messages];
  const allToolCalls: Array<{ name: string; input: any; output: any }> = [];
  let finalText = '';
  // Per-tool-name counter so concurrent invocations of the same tool in a
  // single assistant turn (e.g. listEntities() then listEntities({pkg}))
  // get distinct stream ids — `listEntities:0`, `listEntities:1`, …
  // (#124). The model-supplied tc.id is preferred when present.
  const callSeq: Record<string, number> = {};
  // Sum upstream `data.usage` across every step (incl. tool-call rounds)
  // so the chat header can render a running total. OpenAI-compatible
  // responses include `usage: { prompt_tokens, completion_tokens }` at
  // the top level of each completion. (#128)
  const usage: DirectClientUsage = { inputTokens: 0, outputTokens: 0 };
  // Set to false the moment the loop exits via `break` (a natural finish with
  // no tool calls). If the `for` condition expires first, it stays true and we
  // run a graceful summary turn below (#192).
  let stoppedAtStepLimit = true;

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) {
      return { text: finalText, toolCalls: allToolCalls, aborted: true, usage, stoppedAtStepLimit: false };
    }

    let response: Response;
    try {
      response = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: currentMessages,
          tools: tools.length > 0 ? tools : undefined,
          tool_choice: tools.length > 0 ? 'auto' : undefined,
          max_tokens: 4096,
        }),
        signal,
      });
    } catch (err: any) {
      // fetch throws on abort with name === 'AbortError' (or DOMException)
      if (err?.name === 'AbortError' || signal?.aborted) {
        return { text: finalText, toolCalls: allToolCalls, aborted: true, usage, stoppedAtStepLimit: false };
      }
      throw err;
    }

    if (!response.ok) {
      const errText = await response.text();
      // Upstream OpenAI-compatible providers return their error as
      // structured JSON (e.g. OpenRouter's quota/credits errors). Unwrap
      // it so the user sees the human-readable message instead of the
      // wrapper noise. The full body still lands in raw events.
      let providerMessage: string | undefined;
      let providerCode: string | number | undefined;
      let providerHelpUrl: string | undefined;
      try {
        const parsed = JSON.parse(errText);
        const e = parsed?.error || parsed;
        if (typeof e?.message === 'string') providerMessage = e.message;
        if (e?.code !== undefined) providerCode = e.code;
        // Heuristic: pull a help URL out of the message if the provider
        // includes one inline (OpenRouter does for billing errors).
        const urlMatch = typeof providerMessage === 'string'
          ? providerMessage.match(/https?:\/\/\S+/)
          : null;
        if (urlMatch) providerHelpUrl = urlMatch[0];
      } catch { /* not JSON — fall through to the raw text */ }
      const err = new Error(providerMessage || `Upstream provider returned ${response.status}: ${errText.slice(0, 200)}`);
      // Stash structured fields so the controller can forward them on
      // the SSE error event without re-parsing.
      Object.assign(err, {
        upstreamStatus: response.status,
        providerMessage,
        providerCode,
        providerHelpUrl,
        providerRaw: errText,
      });
      throw err;
    }

    const data: any = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No response from model');

    // Capture per-step usage (#128). OpenAI-compatible providers
    // return prompt_tokens/completion_tokens; some name them
    // input_tokens/output_tokens — accept both shapes.
    if (data.usage) {
      const u = data.usage;
      const inTok = typeof u.prompt_tokens === 'number'
        ? u.prompt_tokens
        : (typeof u.input_tokens === 'number' ? u.input_tokens : 0);
      const outTok = typeof u.completion_tokens === 'number'
        ? u.completion_tokens
        : (typeof u.output_tokens === 'number' ? u.output_tokens : 0);
      usage.inputTokens += inTok;
      usage.outputTokens += outTok;
    }

    const msg = choice.message;
    finalText = msg.content || '';

    // Deliberately do NOT emit `finalText` here. Weak tool-callers return a
    // preamble/"reply" in the SAME response as their tool calls; emitting it now
    // would stream the reply BEFORE the tools run — the reported bug where "tool
    // calls happen after the model reply". The loop emits only tool events; the
    // controller streams the returned `result.text` ONCE after the loop (i.e.
    // after all tools), so the reply always follows the tools. The step content
    // is still added to the model's own context below.

    // Check for tool calls
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Add assistant message with tool calls to context
      currentMessages.push({
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.tool_calls,
      });

      // Execute each tool call
      for (const tc of msg.tool_calls) {
        if (signal?.aborted) {
          return { text: finalText, toolCalls: allToolCalls, aborted: true, usage, stoppedAtStepLimit: false };
        }

        const toolName = tc.function.name;
        let toolArgs: any = {};
        try {
          toolArgs = JSON.parse(tc.function.arguments || '{}');
        } catch {
          toolArgs = {};
        }

        // Distinct id per invocation. Prefer the provider-supplied id when
        // available; otherwise build `${name}:${seq}` so the same tool
        // called twice in one turn yields two cards on the frontend.
        const seq = callSeq[toolName] ?? 0;
        callSeq[toolName] = seq + 1;
        const toolCallId = tc.id || `${toolName}:${seq}`;

        logger.info(`AI tool call: ${toolName}(${JSON.stringify(toolArgs).slice(0, 100)})`);

        if (onEvent) {
          onEvent({ type: 'tool-start', name: toolName, toolCallId, input: toolArgs });
        }

        const result = await executeToolFn(toolName, toolArgs, toolCallId);
        allToolCalls.push({ name: toolName, input: toolArgs, output: result });

        if (onEvent) {
          onEvent({ type: 'tool-end', name: toolName, toolCallId, input: toolArgs, output: result });
        }

        // Add tool result to context
        currentMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }

      // Continue to next step (model will see tool results and respond)
      continue;
    }

    // No tool calls — model finished naturally.
    stoppedAtStepLimit = false;
    break;
  }

  // The loop exhausted its step budget while the model still wanted to call
  // tools (#192). Make ONE final, tool-less call nudging the model to wrap up:
  // summarize what it changed and list the remaining steps. Its text becomes
  // the turn's closing message instead of a dangling tool card.
  if (stoppedAtStepLimit && !signal?.aborted) {
    const nudgeMessages: Message[] = [
      ...currentMessages,
      {
        role: 'user',
        content:
          "You've reached the step limit and can't call more tools. Summarize what you changed and list the remaining steps to finish.",
      },
    ];

    try {
      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: nudgeMessages,
          // tools omitted on purpose — the model cannot call more tools.
          max_tokens: 4096,
        }),
        signal,
      });

      if (response.ok) {
        const data: any = await response.json();
        if (data.usage) {
          const u = data.usage;
          const inTok = typeof u.prompt_tokens === 'number'
            ? u.prompt_tokens
            : (typeof u.input_tokens === 'number' ? u.input_tokens : 0);
          const outTok = typeof u.completion_tokens === 'number'
            ? u.completion_tokens
            : (typeof u.output_tokens === 'number' ? u.output_tokens : 0);
          usage.inputTokens += inTok;
          usage.outputTokens += outTok;
        }
        const summary = data.choices?.[0]?.message?.content || '';
        if (summary) {
          // Set finalText ONLY — do not also push through onEvent. The
          // controller streams the returned `result.text` once after
          // callWithTools (tool calls always precede a cap-stop), so emitting
          // here too would duplicate the summary in the bubble (#192 review).
          finalText = summary;
        }
      }
    } catch (err: any) {
      // A failed summary turn must not mask the real work the loop did; the
      // caller still emits the step-limit notice. Swallow abort, rethrow nothing.
      if (!(err?.name === 'AbortError' || signal?.aborted)) {
        logger.warn(`AI summary turn failed: ${err?.message ?? err}`);
      }
    }
  }

  return { text: finalText, toolCalls: allToolCalls, usage, stoppedAtStepLimit };
}
