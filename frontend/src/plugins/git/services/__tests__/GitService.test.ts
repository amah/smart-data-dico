/**
 * #160 GitService unit suite.
 *
 * Covers spec acceptance criterion #38:
 *   - Service is constructed with a stub `AxiosInstance` (constructor
 *     injection — NOT vi.mock('axios')).
 *   - Each method calls the stub with the correct URL and body.
 *   - No internal try/catch — page is responsible for surfacing errors.
 *
 * Pattern B precedent: IntegrityService.test.ts (from #155).
 */

import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { GitService } from '../GitService';

function makeStubHttp(
  getMock: ReturnType<typeof vi.fn> = vi.fn(),
  postMock: ReturnType<typeof vi.fn> = vi.fn(),
): AxiosInstance {
  return { get: getMock, post: postMock } as unknown as AxiosInstance;
}

describe('GitService — unit (constructor-injected http)', () => {
  it('getStatus() calls http.get with "/git/dictionaries/status/."', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { branch: 'main', files: [] } });
    const service = new GitService(makeStubHttp(getMock));

    await service.getStatus();

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('/git/dictionaries/status/.');
  });

  it('getStatus() returns the response.data directly', async () => {
    const statusData = { branch: 'main', ahead: 0, behind: 0, files: [] };
    const getMock = vi.fn().mockResolvedValue({ data: statusData });
    const service = new GitService(makeStubHttp(getMock));

    const result = await service.getStatus();

    expect(result).toEqual(statusData);
  });

  it('listBranches() calls http.get with "/git/dictionaries/branches/."', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { current: 'main', local: ['main'] } });
    const service = new GitService(makeStubHttp(getMock));

    await service.listBranches();

    expect(getMock).toHaveBeenCalledWith('/git/dictionaries/branches/.');
  });

  it('checkout() calls http.post with branch and create params', async () => {
    const postMock = vi.fn().mockResolvedValue({ data: {} });
    const service = new GitService(makeStubHttp(vi.fn(), postMock));

    await service.checkout('feature/foo', true);

    expect(postMock).toHaveBeenCalledWith('/git/dictionaries/checkout/.', { branch: 'feature/foo', create: true });
  });

  it('commit() calls http.post with message', async () => {
    const postMock = vi.fn().mockResolvedValue({ data: { data: { commitHash: 'abc123' } } });
    const service = new GitService(makeStubHttp(vi.fn(), postMock));

    const result = await service.commit('test commit');

    expect(postMock).toHaveBeenCalledWith('/git/dictionaries/commit/.', { message: 'test commit' });
    expect(result).toEqual({ data: { commitHash: 'abc123' } });
  });

  it('pull() calls http.post with remote', async () => {
    const postMock = vi.fn().mockResolvedValue({ data: {} });
    const service = new GitService(makeStubHttp(vi.fn(), postMock));

    await service.pull('origin');

    expect(postMock).toHaveBeenCalledWith('/git/dictionaries/pull/.', { remote: 'origin' });
  });

  it('push() calls http.post with remote', async () => {
    const postMock = vi.fn().mockResolvedValue({ data: {} });
    const service = new GitService(makeStubHttp(vi.fn(), postMock));

    await service.push('origin');

    expect(postMock).toHaveBeenCalledWith('/git/dictionaries/push/.', { remote: 'origin' });
  });

  it('diff() calls http.get with "/git/dictionaries/diff/." and optional file param', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { diff: '--- a\n+++ b\n' } });
    const service = new GitService(makeStubHttp(getMock));

    await service.diff('some/file.yaml');

    expect(getMock).toHaveBeenCalledWith(
      '/git/dictionaries/diff/.',
      { params: { file: 'some/file.yaml' } },
    );
  });

  it('diff() omits file param when not provided', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { diff: '' } });
    const service = new GitService(makeStubHttp(getMock));

    await service.diff();

    expect(getMock).toHaveBeenCalledWith('/git/dictionaries/diff/.', { params: {} });
  });

  it('log() calls http.get with maxCount param', async () => {
    const logData = [{ hash: 'abc', date: '2026-01-01', author: 'user', message: 'msg' }];
    const getMock = vi.fn().mockResolvedValue({ data: logData });
    const service = new GitService(makeStubHttp(getMock));

    const result = await service.log(50);

    expect(getMock).toHaveBeenCalledWith('/git/dictionaries/log/.', { params: { maxCount: 50 } });
    expect(result).toEqual(logData);
  });

  it('log() omits maxCount when limit is undefined', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: [] });
    const service = new GitService(makeStubHttp(getMock));

    await service.log();

    expect(getMock).toHaveBeenCalledWith('/git/dictionaries/log/.', { params: {} });
  });

  it('getStatus() rejects when http.get rejects (no internal swallow)', async () => {
    const getMock = vi.fn().mockRejectedValue(new Error('network error'));
    const service = new GitService(makeStubHttp(getMock));

    await expect(service.getStatus()).rejects.toThrow('network error');
  });

  it('default construction (no http arg) does not throw and produces a usable instance', () => {
    const service = new GitService();
    expect(service).toBeInstanceOf(GitService);
    expect(typeof service.getStatus).toBe('function');
  });
});
