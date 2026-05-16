import axios, { type AxiosInstance } from 'axios';
import type { GitService } from '../../git/services/GitService';

export interface SaveResult {
  commitHash?: string;
}

/**
 * Domain-level composite service for "save & publish" operations owned by
 * the data-dictionary plugin.
 *
 * Pattern B per cookbook §3b: wraps GitService (transport) with domain
 * semantics. Constructed inside `dataDictionaryPlugin.initialize` and
 * provided under `PUBLISH_SERVICE_TOKEN`.
 *
 * The `revert` method is a domain add-on — the framework's IGitClient has
 * no `revert` op (verified at dist/spi/providers/i-git-client.d.ts:10-87).
 * We call the legacy `/api/revert` endpoint kept on the backend's
 * versionService for one release. Delete once the upstream framework adds
 * revert.
 */
export class PublishService {
  private readonly http: AxiosInstance;

  constructor(
    private readonly git: GitService,
    http?: AxiosInstance,
  ) {
    this.http = http ?? PublishService.createDefaultHttp();
  }

  /**
   * Compose: commit current changes with the given message.
   * Mirror of the deleted legacy commitChanges contract — same
   * return shape so call-sites stay mechanical.
   */
  async save(message: string): Promise<SaveResult> {
    const result = await this.git.commit(message);
    // The framework git commit response shape is { data: { commitHash } }
    // (matches GitCommitDTO). Return the inner hash if present.
    const hash = (result as any)?.data?.commitHash ?? (result as any)?.hash;
    return { commitHash: hash };
  }

  /** Compose: push to origin. */
  async publish(remote?: string): Promise<void> {
    await this.git.push(remote);
  }

  /** Compose: pull from origin. */
  async sync(remote?: string): Promise<void> {
    await this.git.pull(remote);
  }

  /**
   * Domain add-on. Framework IGitClient has no `revert` op; we call the
   * legacy `/api/revert` endpoint kept on the backend's versionService
   * for one release. Delete once the upstream framework lands revert.
   *
   * TODO: remove once @hamak/ui-remote-git-fs-backend exposes revert.
   */
  async revert(commitHash: string): Promise<{ newCommitHash?: string }> {
    const response = await this.http.post<{ data: { newCommitHash?: string } }>(
      '/revert',
      { commitHash },
    );
    return { newCommitHash: response.data?.data?.newCommitHash };
  }

  private static createDefaultHttp(): AxiosInstance {
    const instance = axios.create({
      baseURL: '/api',
      headers: { 'Content-Type': 'application/json' },
    });
    instance.interceptors.request.use((config) => {
      const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    return instance;
  }
}
