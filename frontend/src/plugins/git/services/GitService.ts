import axios, { type AxiosInstance } from 'axios';

/**
 * Mirrors GitStatusResponse from
 * `@hamak/ui-remote-git-fs/dist/api/types/git-state.types.d.ts` but we
 * expose the loose shape the backend actually emits (which historically
 * included `current`, `branch` as object-or-string, etc.).
 */
export interface GitStatusDTO {
  branch?: { current: string; tracking?: string; ahead: number; behind: number } | string;
  current?: string;
  ahead?: number;
  behind?: number;
  hasUncommittedChanges?: boolean;
  files?: Array<{ path: string; status: string; staged?: boolean; working_dir?: string }>;
  modified?: string[];
  not_added?: string[];
  created?: string[];
  deleted?: string[];
}

export interface GitBranchListDTO {
  current: string | { name: string };
  local?: string[];
  remote?: string[];
  branches?: string[];
  all?: string[];
}

export interface GitCommitDTO {
  data: { commitHash: string };
  message?: string;
}

export interface GitLogEntryDTO {
  hash: string;
  date: string;
  author: string;
  author_name?: string;
  author_email?: string;
  message: string;
  changes?: { added: string[]; modified: string[]; deleted: string[] };
}

/**
 * Pattern B service — thin axios wrapper over the framework's
 * `/api/git/dictionaries/**` endpoints.
 *
 * NOT a Store FS facade: git operations are computed against the live
 * filesystem on the backend; there is no logical "file" to cache reactive
 * state for. Per cookbook §3b (IntegrityService precedent): eager
 * `useValue`, optional axios injection, self-contained auth interceptor.
 *
 * The service does NOT consume the framework's `HttpGitClient` directly —
 * we run our own axios because we need flexible response-shape handling
 * that matches the legacy backend's loose JSON contracts (`branch` as
 * object-or-string, etc.) and so unit tests can inject a stub.
 */
export class GitService {
  private readonly http: AxiosInstance;

  /**
   * @param http  Optional injected AxiosInstance. The override exists so
   *              unit tests can pass a stub client (Pattern B precedent —
   *              see IntegrityService). Production callers pass nothing and
   *              get the default instance with the auth interceptor.
   */
  constructor(http?: AxiosInstance) {
    this.http = http ?? GitService.createDefaultHttp();
  }

  /** GET /api/git/dictionaries/status/. */
  async getStatus(): Promise<GitStatusDTO> {
    const response = await this.http.get<GitStatusDTO>('/git/dictionaries/status/.');
    return response.data;
  }

  /** GET /api/git/dictionaries/branches/. */
  async listBranches(): Promise<GitBranchListDTO> {
    const response = await this.http.get<GitBranchListDTO>('/git/dictionaries/branches/.');
    return response.data;
  }

  /** POST /api/git/dictionaries/checkout/. — `create=true` creates the branch. */
  async checkout(branch: string, create?: boolean): Promise<void> {
    await this.http.post('/git/dictionaries/checkout/.', { branch, create });
  }

  /** POST /api/git/dictionaries/commit/. — direct framework commit
   *  (no domain stage step; used for the simple CommitChanges page). */
  async commit(message: string): Promise<GitCommitDTO> {
    const response = await this.http.post<GitCommitDTO>('/git/dictionaries/commit/.', { message });
    return response.data;
  }

  /** POST /api/git/dictionaries/pull/. */
  async pull(remote?: string): Promise<void> {
    await this.http.post('/git/dictionaries/pull/.', { remote });
  }

  /** POST /api/git/dictionaries/push/. */
  async push(remote?: string): Promise<void> {
    await this.http.post('/git/dictionaries/push/.', { remote });
  }

  /** GET /api/git/dictionaries/diff/. (file optional). */
  async diff(file?: string): Promise<{ diff: string; file?: string }> {
    const response = await this.http.get<{ diff: string; file?: string }>(
      '/git/dictionaries/diff/.',
      { params: file ? { file } : {} },
    );
    return response.data;
  }

  /** GET /api/git/dictionaries/log/. — log is provided by the framework's
   *  HttpGitClient (`/log/<path>?maxCount=N`). The framework backend already
   *  serves this; the legacy `/api/history` endpoint is deleted. */
  async log(limit?: number): Promise<GitLogEntryDTO[]> {
    const response = await this.http.get<GitLogEntryDTO[]>(
      '/git/dictionaries/log/.',
      { params: limit !== undefined ? { maxCount: limit } : {} },
    );
    return response.data;
  }

  private static createDefaultHttp(): AxiosInstance {
    const instance = axios.create({
      baseURL: '/api',
      headers: { 'Content-Type': 'application/json' },
    });
    instance.interceptors.request.use((config) => {
      // Mirrors api.ts:23-32. The `|| 'mock-token-for-testing'` fallback
      // is a dev-environment hack inherited from api.ts:25 — flag for
      // cleanup alongside that file (out of scope for this PR).
      const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
    return instance;
  }
}
