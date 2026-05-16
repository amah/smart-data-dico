/**
 * #160 PublishService unit suite.
 *
 * Covers spec acceptance criterion #38:
 *   - Service is constructed with a mock GitService (dependency injection).
 *   - save() delegates to git.commit() and returns the commitHash.
 *   - publish() delegates to git.push().
 *   - sync() delegates to git.pull().
 *   - revert() calls the /revert endpoint via the injected http stub.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AxiosInstance } from 'axios';
import { PublishService } from '../PublishService';
import type { GitService } from '../../git/services/GitService';

function makeGitServiceMock(): GitService {
  return {
    getStatus: vi.fn().mockResolvedValue({}),
    listBranches: vi.fn().mockResolvedValue({}),
    checkout: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ data: { commitHash: 'abc123' } }),
    pull: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    diff: vi.fn().mockResolvedValue({ diff: '' }),
    log: vi.fn().mockResolvedValue([]),
  } as unknown as GitService;
}

function makeStubHttp(postMock: ReturnType<typeof vi.fn>): AxiosInstance {
  return { post: postMock } as unknown as AxiosInstance;
}

describe('PublishService — unit (injected GitService + http)', () => {
  it('save() delegates to git.commit() with the message', async () => {
    const git = makeGitServiceMock();
    const service = new PublishService(git);

    await service.save('my commit message');

    expect(git.commit).toHaveBeenCalledWith('my commit message');
  });

  it('save() returns the commitHash from git.commit result', async () => {
    const git = makeGitServiceMock();
    (git.commit as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { commitHash: 'def456' } });
    const service = new PublishService(git);

    const result = await service.save('test');

    expect(result.commitHash).toBe('def456');
  });

  it('publish() delegates to git.push() with the optional remote', async () => {
    const git = makeGitServiceMock();
    const service = new PublishService(git);

    await service.publish('upstream');

    expect(git.push).toHaveBeenCalledWith('upstream');
  });

  it('publish() delegates to git.push() with undefined when no remote given', async () => {
    const git = makeGitServiceMock();
    const service = new PublishService(git);

    await service.publish();

    expect(git.push).toHaveBeenCalledWith(undefined);
  });

  it('sync() delegates to git.pull() with the optional remote', async () => {
    const git = makeGitServiceMock();
    const service = new PublishService(git);

    await service.sync('origin');

    expect(git.pull).toHaveBeenCalledWith('origin');
  });

  it('revert() posts to /revert with commitHash', async () => {
    const git = makeGitServiceMock();
    const postMock = vi.fn().mockResolvedValue({
      data: { data: { newCommitHash: 'rev789' } },
    });
    const service = new PublishService(git, makeStubHttp(postMock));

    const result = await service.revert('commit-to-revert');

    expect(postMock).toHaveBeenCalledWith('/revert', { commitHash: 'commit-to-revert' });
    expect(result.newCommitHash).toBe('rev789');
  });

  it('revert() rejects when http.post rejects (no internal swallow)', async () => {
    const git = makeGitServiceMock();
    const postMock = vi.fn().mockRejectedValue(new Error('revert failed'));
    const service = new PublishService(git, makeStubHttp(postMock));

    await expect(service.revert('bad-hash')).rejects.toThrow('revert failed');
  });

  it('default construction (no http arg) does not throw and produces a usable instance', () => {
    const git = makeGitServiceMock();
    const service = new PublishService(git);
    expect(service).toBeInstanceOf(PublishService);
    expect(typeof service.save).toBe('function');
    expect(typeof service.publish).toBe('function');
    expect(typeof service.sync).toBe('function');
    expect(typeof service.revert).toBe('function');
  });
});
