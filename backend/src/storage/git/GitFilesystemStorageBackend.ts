import type { IStorageBackend, ChangeObservable } from '../contract/IStorageBackend.js';
import type {
  WorkspaceId, Path, Bytes, WriteOpts, WriteResult,
  DirectoryEntry, Stat, WorkspaceHandle, CreateWorkspaceOpts, MergeResult,
} from '../contract/types.js';
import { pathOf } from '../contract/types.js';
import { GIT_FILESYSTEM_CAPABILITIES, type BackendCapabilities } from '../contract/BackendCapabilities.js';
import { BackendError, NotFoundError, ConflictError } from '../contract/errors.js';

/**
 * Structural match for IWorkspaceManager from @hamak/filesystem-server-api.
 *
 * Defined locally because @hamak/filesystem-server-api is not a direct dependency
 * of the backend (ADR-0001 dependency audit removed it); importing types from transitive
 * packages is rejected by NodeNext module resolution in TypeScript 5.x.
 *
 * The FileInfo shape mirrors @hamak/shared-utils FileInfo (verified against
 * node_modules/@hamak/shared-utils/dist/core-utils-file.d.ts).
 */
interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  createdAt: Date;
  updatedAt: Date;
  content?: string;
}

export interface IWorkspaceManager {
  listFiles(workspace: string, path: string | string[]): Promise<FileInfo[]>;
  readFile(workspace: string, path: string | string[]): Promise<FileInfo>;
  writeFile(workspace: string, path: string | string[], content: string): Promise<FileInfo>;
  deleteFile(workspace: string, path: string | string[]): Promise<FileInfo>;
  createDirectory(workspace: string, path: string | string[]): Promise<FileInfo>;
  getFile(workspace: string, path: string | string[]): Promise<FileInfo>;
}

export interface GitFilesystemStorageBackendOptions {
  /** The framework workspace id used today ('dictionaries'). All requests delegate using this id. */
  workspaceId: string;
}

export class GitFilesystemStorageBackend implements IStorageBackend {
  constructor(
    private readonly wm: IWorkspaceManager,
    private readonly opts: GitFilesystemStorageBackendOptions,
  ) {}

  // ---- Read -----------------------------------------------------------------

  async read(_ws: WorkspaceId, path: Path): Promise<Bytes> {
    try {
      const info = await this.wm.readFile(this.opts.workspaceId, this.toSegments(path));
      return info.content ?? '';
    } catch (err) {
      if (this.isEnoent(err)) {
        throw new NotFoundError(_ws, path, err);
      }
      throw err;
    }
  }

  async list(_ws: WorkspaceId, path: Path): Promise<DirectoryEntry[]> {
    const infos = await this.wm.listFiles(this.opts.workspaceId, this.toSegments(path));
    return infos.map((info) => ({
      name: info.name,
      path: pathOf(info.path),
      isDirectory: info.isDirectory,
      size: info.size,
      updatedAt: info.updatedAt,
    }));
  }

  async stat(_ws: WorkspaceId, path: Path): Promise<Stat> {
    try {
      const info = await this.wm.getFile(this.opts.workspaceId, this.toSegments(path));
      return {
        path: pathOf(info.path),
        isDirectory: false,
        size: info.size,
        createdAt: info.createdAt,
        updatedAt: info.updatedAt,
        etag: this.etagOf(info.size, info.updatedAt),
      };
    } catch (err) {
      // workspace-manager.js:55-57 throws 'Path is a directory' when called on a directory.
      // Note: errors from the ESM workspace-manager may not pass `instanceof Error` in CJS
      // Jest test contexts; check message directly via property access.
      if (this.isMessageMatch(err, 'Path is a directory')) {
        // Fall back: list parent directory and find the entry by name
        const segs = this.toSegments(path);
        const parentSegs = segs.slice(0, -1);
        const name = segs[segs.length - 1];
        const siblings = await this.wm.listFiles(this.opts.workspaceId, parentSegs);
        const entry = siblings.find((s) => s.name === name);
        if (entry) {
          return {
            path: pathOf(entry.path),
            isDirectory: true,
            size: entry.size,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            etag: this.etagOf(entry.size, entry.updatedAt),
          };
        }
        // If not found in parent listing, still a directory (empty or race) — return minimal stat
        return {
          path,
          isDirectory: true,
          size: 0,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          etag: this.etagOf(0, new Date(0)),
        };
      }
      if (this.isEnoent(err)) {
        throw new NotFoundError(_ws, path, err);
      }
      throw err;
    }
  }

  // ---- Write ----------------------------------------------------------------

  async write(_ws: WorkspaceId, path: Path, bytes: Bytes, opts?: WriteOpts): Promise<WriteResult> {
    const segs = this.toSegments(path);

    // 1. Optimistic concurrency check
    if (opts?.ifMatch !== undefined) {
      const current = await this.stat(_ws, path);
      if (current.etag !== opts.ifMatch) {
        throw new ConflictError(
          `ETag mismatch for ${path}: expected ${opts.ifMatch}, got ${current.etag}`,
        );
      }
    }

    // 2. Create parent directories if requested
    if (opts?.createParents) {
      const parentSegs = segs.slice(0, -1);
      if (parentSegs.length > 0) {
        await this.wm.createDirectory(this.opts.workspaceId, parentSegs);
      }
    }

    // 3. Write the file
    await this.wm.writeFile(this.opts.workspaceId, segs, bytes);

    // 4. Re-stat to get fresh mtime/size for the WriteResult
    const stat = await this.stat(_ws, path);
    return {
      path,
      size: stat.size,
      etag: stat.etag,
      updatedAt: stat.updatedAt,
    };
  }

  async delete(_ws: WorkspaceId, path: Path): Promise<void> {
    try {
      await this.wm.deleteFile(this.opts.workspaceId, this.toSegments(path));
    } catch (err) {
      if (this.isEnoent(err)) {
        throw new NotFoundError(_ws, path, err);
      }
      throw err;
    }
  }

  async mkdir(_ws: WorkspaceId, path: Path, _parents?: boolean): Promise<void> {
    // wm.createDirectory always recurses (fs.mkdir recursive:true) so
    // the `parents` arg is documented but ignored (known gap, see spec §3).
    await this.wm.createDirectory(this.opts.workspaceId, this.toSegments(path));
  }

  // ---- Change notification (FRAMEWORK GAP) ---------------------------------

  subscribe(_ws: WorkspaceId, _path: Path): ChangeObservable {
    throw new BackendError('subscribe() not implemented — pending file-watch slice', 'not-implemented');
  }

  // ---- Workspace lifecycle (FRAMEWORK GAP) ---------------------------------

  async createWorkspace(_id: WorkspaceId, _opts?: CreateWorkspaceOpts): Promise<WorkspaceHandle> {
    throw new BackendError('createWorkspace() not implemented — pending #169 git-worktree slice', 'not-implemented');
  }

  async forkWorkspace(_srcId: WorkspaceId, _destId: WorkspaceId): Promise<WorkspaceHandle> {
    throw new BackendError('forkWorkspace() not implemented — pending #169 git-worktree slice', 'not-implemented');
  }

  async mergeWorkspace(_srcId: WorkspaceId, _destId: WorkspaceId): Promise<MergeResult> {
    throw new BackendError('mergeWorkspace() not implemented — pending #169 git-worktree slice', 'not-implemented');
  }

  async deleteWorkspace(_id: WorkspaceId): Promise<void> {
    throw new BackendError('deleteWorkspace() not implemented — pending #169 git-worktree slice', 'not-implemented');
  }

  // ---- Self-description -----------------------------------------------------

  capabilities(): BackendCapabilities { return GIT_FILESYSTEM_CAPABILITIES; }

  // ---- Internal helpers -----------------------------------------------------

  /** Path → segments array, dropping empty entries so '' and '/' both → []. */
  private toSegments(p: Path): string[] { return String(p).split('/').filter(Boolean); }

  private etagOf(size: number, mtime: Date): string { return `${mtime.getTime()}-${size}`; }

  private isMessageMatch(err: unknown, msg: string): boolean {
    if (err == null || typeof err !== 'object') return false;
    const e = err as Record<string, unknown>;
    return typeof e['message'] === 'string' && e['message'] === msg;
  }

  private isEnoent(err: unknown): boolean {
    // Note: errors from @hamak/filesystem-server-impl (ESM) may not pass
    // `instanceof Error` in CJS Jest test contexts due to the ESM/CJS boundary.
    // Check for ENOENT via the `code` property or message prefix directly.
    if (err == null || typeof err !== 'object') return false;
    const e = err as Record<string, unknown>;
    if (e['code'] === 'ENOENT') return true;
    if (typeof e['message'] === 'string' && e['message'].startsWith('ENOENT:')) return true;
    return false;
  }
}
