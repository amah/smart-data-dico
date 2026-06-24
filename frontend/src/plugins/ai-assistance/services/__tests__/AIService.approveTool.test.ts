/**
 * Unit test for AIService.approveTool — the Pattern B REST call that
 * settles a server-side tool-approval gate.
 *
 * approveTool POSTs `{streamId, toolCallId, decision}` to /ai/chat/approve
 * on its injected axios instance (baseURL '/api'). We inject a stub axios
 * instance so the test asserts the exact path + body without a network.
 *
 * Supports acceptance criteria 13–15 at the service boundary (the panel
 * tests cover the same path end-to-end through the command bus).
 */
import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { AIService } from '../AIService';

function makeHttpStub() {
  const post = vi.fn().mockResolvedValue({ data: { ok: true } });
  // Only `post` is exercised by approveTool; cast the partial as AxiosInstance.
  return { post } as unknown as AxiosInstance & { post: ReturnType<typeof vi.fn> };
}

describe('AIService.approveTool', () => {
  it('POSTs an approve decision to /ai/chat/approve', async () => {
    const http = makeHttpStub();
    const svc = new AIService(http);

    await svc.approveTool('stream-1', 'call-1', 'approve');

    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith('/ai/chat/approve', {
      streamId: 'stream-1',
      toolCallId: 'call-1',
      decision: 'approve',
    });
  });

  it('POSTs a deny decision to /ai/chat/approve', async () => {
    const http = makeHttpStub();
    const svc = new AIService(http);

    await svc.approveTool('stream-2', 'call-2', 'deny');

    expect(http.post).toHaveBeenCalledWith('/ai/chat/approve', {
      streamId: 'stream-2',
      toolCallId: 'call-2',
      decision: 'deny',
    });
  });
});
