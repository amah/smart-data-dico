/**
 * Server-side approval gate registry for AI tool calls.
 *
 * The AI chat streams tool-input events to the client and then BLOCKS the
 * tool executor until the client posts an approve/deny decision back. This
 * module is the rendezvous point: the executor parks on a promise keyed by
 * `${streamId}::${toolCallId}` and the approve endpoint resolves it.
 *
 * Kept deliberately dependency-free (no Express, no services) so it stays
 * trivially unit-testable and reusable from both chat execution paths
 * (the openai-compatible direct client and the Vercel AI SDK path).
 */

export type ApprovalDecision = 'approve' | 'deny';

interface PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
}

/**
 * Module-level registry of in-flight approvals. Keyed by
 * `${streamId}::${toolCallId}` so a single stream can have multiple
 * concurrent gated tool calls and each resolves independently.
 */
const pending = new Map<string, PendingApproval>();

function key(streamId: string, toolCallId: string): string {
  return `${streamId}::${toolCallId}`;
}

/**
 * Register a gated tool call and return a promise that settles when the
 * client posts a decision (or the stream is aborted, which forces 'deny').
 * The executor `await`s this before performing the real mutation.
 */
export function awaitApproval(streamId: string, toolCallId: string): Promise<ApprovalDecision> {
  const k = key(streamId, toolCallId);
  return new Promise<ApprovalDecision>((resolve) => {
    // If the same key is somehow re-registered, deny the stale waiter so
    // it can't dangle forever, then install the new one.
    const existing = pending.get(k);
    if (existing) existing.resolve('deny');
    pending.set(k, {
      resolve: (decision) => {
        pending.delete(k);
        resolve(decision);
      },
    });
  });
}

/**
 * Resolve a pending approval. Returns true when a matching waiter was
 * found and settled, false when none was pending (e.g. the client posts
 * for a tool call that already resolved or never gated).
 */
export function settleApproval(streamId: string, toolCallId: string, decision: ApprovalDecision): boolean {
  const k = key(streamId, toolCallId);
  const entry = pending.get(k);
  if (!entry) return false;
  entry.resolve(decision);
  return true;
}

/**
 * Resolve EVERY pending approval for a stream as 'deny'. Called when the
 * client disconnects / aborts so blocked executors unblock instead of
 * leaking a parked promise for the life of the process.
 */
export function abortStreamApprovals(streamId: string): void {
  const prefix = `${streamId}::`;
  for (const [k, entry] of pending) {
    if (k.startsWith(prefix)) {
      entry.resolve('deny');
    }
  }
}
