/**
 * #63 — Context condensing for long conversations.
 *
 * Long-running chats eventually push the conversation past the model's
 * context window. Rather than failing or silently truncating, we
 * summarize the older portion of the history into a single compact
 * "context" turn and forward that, plus the recent N turns, to the
 * model. The original conversation file on disk is unchanged — we only
 * rewrite the per-request payload.
 *
 * Trigger: estimated input tokens exceed a configurable threshold
 *          (default 100k tokens — comfortably below Claude Sonnet's
 *          200k context window so the rest of the request still fits).
 * Strategy: keep the most recent KEEP_RECENT messages verbatim;
 *           summarize everything earlier into one text turn.
 *
 * The estimator is a coarse char/4 heuristic. We deliberately avoid
 * pulling in tiktoken-style tokenizers — chars/4 is within ~25% of
 * the true count for English prose, and the threshold is loose
 * enough that the heuristic doesn't need to be precise.
 */
import { generateText, type LanguageModel } from 'ai';

export interface RawMessage {
  role: 'user' | 'assistant' | string;
  parts?: Array<{ type: string; text?: string }>;
  content?: string;
}

export interface CondenseResult {
  /** Replacement message array — pass this to the model in place of the raw input. */
  messages: RawMessage[];
  /** Synthetic summary text injected as the first user turn. */
  summary: string;
  /** Count of original messages folded into the summary. */
  condensedCount: number;
  /** Estimated tokens before condensing — useful for telemetry / SSE event. */
  estimatedTokens: number;
}

/** Default threshold (in tokens). Override via config. */
export const DEFAULT_CONDENSE_THRESHOLD = 100_000;
/**
 * How many recent messages to keep verbatim. The most recent user turn
 * needs full fidelity for tool-call quality; we keep a few prior turns
 * for short-term continuity.
 */
export const KEEP_RECENT = 6;

/**
 * Cheap char-count → token-count estimator. ~4 chars per token is the
 * canonical OpenAI rule of thumb for English; it slightly overestimates
 * for code-heavy content (which is fine — we'd rather condense early
 * than late).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Sum the estimated tokens across every text part in every message.
 * Tool-call payloads aren't included because the AI SDK serializes them
 * separately; the pure text estimate is the load-bearing input.
 */
export function estimateMessageTokens(messages: RawMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (Array.isArray(m.parts)) {
      for (const p of m.parts) {
        if (p.type === 'text' && typeof p.text === 'string') {
          total += estimateTokens(p.text);
        }
      }
    } else if (typeof m.content === 'string') {
      total += estimateTokens(m.content);
    }
  }
  return total;
}

function extractText(m: RawMessage): string {
  if (Array.isArray(m.parts)) {
    return m.parts
      .filter(p => p.type === 'text' && typeof p.text === 'string')
      .map(p => p.text)
      .join(' ');
  }
  return typeof m.content === 'string' ? m.content : '';
}

const SUMMARY_SYSTEM_PROMPT = `You are summarizing a long AI chat about a data dictionary so it fits the model's context window. Preserve:
- entity / package names that were created or referenced
- relationships and key decisions
- the user's stated goals and constraints

Drop:
- tool-call argument JSON
- intermediate "let me check" reasoning
- pleasantries

Output a single paragraph (or a tight bulleted list) under 600 words. Plain prose, no headers.`;

/**
 * Decide whether the messages need condensing and, if so, summarize the
 * older half. Returns null when nothing needs to change so the caller
 * can take the fast path.
 *
 * The summarization itself uses generateText with the same model — a
 * single non-streaming round, ~1-2s of latency. We accept that latency
 * because it only fires on conversations that would otherwise OOM the
 * model anyway.
 */
export async function maybeCondense(
  messages: RawMessage[],
  model: LanguageModel,
  threshold: number = DEFAULT_CONDENSE_THRESHOLD,
): Promise<CondenseResult | null> {
  const estimatedTokens = estimateMessageTokens(messages);
  if (estimatedTokens <= threshold) return null;
  // Need at least KEEP_RECENT + 2 messages for condensing to make sense
  // (otherwise we'd be summarizing a single message into a longer paragraph).
  if (messages.length <= KEEP_RECENT + 1) return null;

  const olderCount = messages.length - KEEP_RECENT;
  const older = messages.slice(0, olderCount);
  const recent = messages.slice(olderCount);

  // Render the older portion as a transcript for the summarizer.
  const transcript = older
    .map(m => `${m.role.toUpperCase()}: ${extractText(m)}`)
    .filter(line => line.length > 6) // drop empty turns
    .join('\n\n');

  const { text: summary } = await generateText({
    model,
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: transcript,
  });

  const summaryMessage: RawMessage = {
    role: 'user',
    parts: [{ type: 'text', text: `[Earlier conversation summary (${olderCount} messages condensed)]\n${summary}` }],
  };

  return {
    messages: [summaryMessage, ...recent],
    summary,
    condensedCount: olderCount,
    estimatedTokens,
  };
}
