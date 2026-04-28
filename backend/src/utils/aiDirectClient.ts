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

export async function callWithTools(
  config: DirectClientConfig,
  messages: Message[],
  tools: ToolDef[],
  executeToolFn: (name: string, args: any) => Promise<any>,
  maxSteps: number = 10,
  onEvent?: (event: any) => void,
): Promise<{ text: string; toolCalls: Array<{ name: string; input: any; output: any }> }> {
  let currentMessages = [...messages];
  const allToolCalls: Array<{ name: string; input: any; output: any }> = [];
  let finalText = '';
  // Per-tool-name counter so concurrent invocations of the same tool in a
  // single assistant turn (e.g. listEntities() then listEntities({pkg}))
  // get distinct stream ids — `listEntities:0`, `listEntities:1`, …
  // (#124). The model-supplied tc.id is preferred when present.
  const callSeq: Record<string, number> = {};

  for (let step = 0; step < maxSteps; step++) {
    const response = await fetch(`${config.baseURL}/chat/completions`, {
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
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No response from model');

    const msg = choice.message;
    finalText = msg.content || '';

    // Emit text event
    if (finalText && onEvent) {
      onEvent({ type: 'text', text: finalText });
    }

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

        const result = await executeToolFn(toolName, toolArgs);
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

    // No tool calls — we're done
    break;
  }

  return { text: finalText, toolCalls: allToolCalls };
}
