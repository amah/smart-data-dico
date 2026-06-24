/**
 * Unit tests for the server-side approval-gate registry.
 *
 * The registry is a pure rendezvous: an executor parks on `awaitApproval`
 * and the approve endpoint settles it via `settleApproval`. These tests
 * cover the resolve-on-settle contract, the unknown-key false return,
 * stream-scoped abort, and per-toolCallId independence.
 *
 * Acceptance criteria 1–5.
 */

import { awaitApproval, settleApproval, abortStreamApprovals } from '../approvalRegistry';

describe('approvalRegistry', () => {
  // AC1: settle('approve') resolves the awaiting promise with 'approve'.
  it('resolves with "approve" after settleApproval(..., "approve")', async () => {
    const promise = awaitApproval('s1', 't1');
    const settled = settleApproval('s1', 't1', 'approve');
    expect(settled).toBe(true);
    await expect(promise).resolves.toBe('approve');
  });

  // AC2: settle('deny') resolves with 'deny'.
  it('resolves with "deny" after settleApproval(..., "deny")', async () => {
    const promise = awaitApproval('s1', 't2');
    const settled = settleApproval('s1', 't2', 'deny');
    expect(settled).toBe(true);
    await expect(promise).resolves.toBe('deny');
  });

  // AC3: settleApproval returns false for an unknown key, true when it settles one.
  it('settleApproval returns false for an unknown streamId/toolCallId', () => {
    expect(settleApproval('nope', 'nope', 'approve')).toBe(false);
  });

  it('settleApproval returns false a second time (entry already consumed)', async () => {
    const promise = awaitApproval('s1', 't3');
    expect(settleApproval('s1', 't3', 'approve')).toBe(true);
    await promise;
    // The entry is deleted on settle, so a duplicate POST finds nothing.
    expect(settleApproval('s1', 't3', 'approve')).toBe(false);
  });

  // AC4: abortStreamApprovals denies every pending entry for one stream,
  // leaving other streams untouched.
  it('abortStreamApprovals denies all pending promises for that stream only', async () => {
    const a1 = awaitApproval('streamA', 't1');
    const a2 = awaitApproval('streamA', 't2');
    const b1 = awaitApproval('streamB', 't1');

    abortStreamApprovals('streamA');

    await expect(a1).resolves.toBe('deny');
    await expect(a2).resolves.toBe('deny');

    // streamB's pending promise must remain unresolved; settling it now
    // proves it was untouched by the abort above.
    const settledB = settleApproval('streamB', 't1', 'approve');
    expect(settledB).toBe(true);
    await expect(b1).resolves.toBe('approve');
  });

  // AC5: two toolCallIds under one streamId settle independently.
  it('two toolCallIds under the same streamId settle independently', async () => {
    const first = awaitApproval('shared', 'callX');
    const second = awaitApproval('shared', 'callY');

    expect(settleApproval('shared', 'callX', 'approve')).toBe(true);
    await expect(first).resolves.toBe('approve');

    // Second is still pending and unaffected.
    expect(settleApproval('shared', 'callY', 'deny')).toBe(true);
    await expect(second).resolves.toBe('deny');
  });

  it('re-registering the same key denies the stale waiter', async () => {
    const stale = awaitApproval('s9', 'dup');
    const fresh = awaitApproval('s9', 'dup');
    // The first waiter is force-denied so it cannot dangle.
    await expect(stale).resolves.toBe('deny');
    // The fresh waiter is the one the registry now tracks.
    expect(settleApproval('s9', 'dup', 'approve')).toBe(true);
    await expect(fresh).resolves.toBe('approve');
  });
});
