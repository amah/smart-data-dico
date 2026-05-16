// backend/src/__tests__/helpers/InMemoryStorageBackend.ts
import type { IStorageBackend, ChangeObservable } from '../../storage/contract/IStorageBackend.js';
import type {
  WorkspaceId, Path, Bytes, WriteOpts, WriteResult,
  DirectoryEntry, Stat, WorkspaceHandle, CreateWorkspaceOpts, MergeResult,
} from '../../storage/contract/types.js';
import { pathOf } from '../../storage/contract/types.js';
import { GIT_FILESYSTEM_CAPABILITIES, type BackendCapabilities } from '../../storage/contract/BackendCapabilities.js';
import { BackendError, NotFoundError } from '../../storage/contract/errors.js';

/**
 * Minimal in-memory IStorageBackend for service-level tests.
 *
 * Slice 2: only `read`/`write`/`list`/`stat`/`delete`/`mkdir` are implemented.
 * `subscribe` + the four workspace-lifecycle methods throw 'not-implemented',
 * matching the slice-1 wrapper's behaviour. Slice 3 will extend this into a
 * full reference implementation.
 *
 * Storage shape: Map<WorkspaceId, Map<canonicalPath, Bytes>>. Directories
 * are implicit — a "directory" exists iff any stored path starts with
 * `${dir}/`. `mkdir` records the directory so empty dirs are observable.
 */
export class InMemoryStorageBackend implements IStorageBackend {
  /** Exposed for tests that want to pre-seed or inspect state. */
  readonly files = new Map<string, Map<string, Bytes>>();
  /** Explicit empty-directory marker set; entries are canonical paths. */
  readonly dirs = new Map<string, Set<string>>();
  private readonly now = () => new Date();

  private bucket(ws: WorkspaceId): Map<string, Bytes> {
    const key = String(ws);
    let m = this.files.get(key);
    if (!m) { m = new Map(); this.files.set(key, m); }
    return m;
  }
  private dirSet(ws: WorkspaceId): Set<string> {
    const key = String(ws);
    let s = this.dirs.get(key);
    if (!s) { s = new Set(); this.dirs.set(key, s); }
    return s;
  }
  private canon(p: Path): string { return String(p).split('/').filter(Boolean).join('/'); }

  async read(ws: WorkspaceId, path: Path): Promise<Bytes> {
    const c = this.canon(path);
    const v = this.bucket(ws).get(c);
    if (v === undefined) throw new NotFoundError(ws, path);
    return v;
  }
  async list(ws: WorkspaceId, path: Path): Promise<DirectoryEntry[]> {
    const prefix = this.canon(path);
    const out = new Map<string, DirectoryEntry>();
    for (const k of this.bucket(ws).keys()) {
      if (!k.startsWith(prefix === '' ? '' : prefix + '/') && k !== prefix) continue;
      const rest = prefix === '' ? k : k.slice(prefix.length + 1);
      if (!rest) continue;
      const [name, ...more] = rest.split('/');
      const isDir = more.length > 0;
      const childPath = prefix === '' ? name : `${prefix}/${name}`;
      if (!out.has(name)) {
        out.set(name, {
          name, path: pathOf(childPath), isDirectory: isDir,
          size: isDir ? 0 : (this.bucket(ws).get(childPath)?.length ?? 0),
          updatedAt: this.now(),
        });
      }
    }
    for (const d of this.dirSet(ws)) {
      if (d === prefix) continue;
      if (!d.startsWith(prefix === '' ? '' : prefix + '/')) continue;
      const rest = prefix === '' ? d : d.slice(prefix.length + 1);
      const [name] = rest.split('/');
      if (!out.has(name)) {
        out.set(name, { name, path: pathOf(prefix === '' ? name : `${prefix}/${name}`), isDirectory: true, size: 0, updatedAt: this.now() });
      }
    }
    return [...out.values()];
  }
  async stat(ws: WorkspaceId, path: Path): Promise<Stat> {
    const c = this.canon(path);
    const v = this.bucket(ws).get(c);
    if (v !== undefined) {
      return { path, isDirectory: false, size: v.length, createdAt: this.now(), updatedAt: this.now(), etag: `${v.length}` };
    }
    // Directory check
    if (this.dirSet(ws).has(c) || [...this.bucket(ws).keys()].some(k => k.startsWith(c + '/'))) {
      return { path, isDirectory: true, size: 0, createdAt: this.now(), updatedAt: this.now(), etag: '0' };
    }
    throw new NotFoundError(ws, path);
  }
  async write(ws: WorkspaceId, path: Path, bytes: Bytes, _opts?: WriteOpts): Promise<WriteResult> {
    const c = this.canon(path);
    this.bucket(ws).set(c, bytes);
    return { path, size: bytes.length, etag: `${bytes.length}`, updatedAt: this.now() };
  }
  async delete(ws: WorkspaceId, path: Path): Promise<void> {
    const c = this.canon(path);
    if (!this.bucket(ws).delete(c)) {
      // permissive: also drop a recorded empty dir if present
      if (!this.dirSet(ws).delete(c)) throw new NotFoundError(ws, path);
    }
  }
  async mkdir(ws: WorkspaceId, path: Path, _parents?: boolean): Promise<void> {
    const c = this.canon(path);
    if (c) this.dirSet(ws).add(c);
  }
  // ---- not-implemented in slice 2 (parity with GitFilesystemStorageBackend) ----
  subscribe(_ws: WorkspaceId, _path: Path): ChangeObservable {
    throw new BackendError('subscribe() not implemented in InMemoryStorageBackend (slice 2)', 'not-implemented');
  }
  async createWorkspace(_id: WorkspaceId, _opts?: CreateWorkspaceOpts): Promise<WorkspaceHandle> {
    throw new BackendError('createWorkspace() not implemented in InMemoryStorageBackend (slice 2)', 'not-implemented');
  }
  async forkWorkspace(_s: WorkspaceId, _d: WorkspaceId): Promise<WorkspaceHandle> {
    throw new BackendError('forkWorkspace() not implemented in InMemoryStorageBackend (slice 2)', 'not-implemented');
  }
  async mergeWorkspace(_s: WorkspaceId, _d: WorkspaceId): Promise<MergeResult> {
    throw new BackendError('mergeWorkspace() not implemented in InMemoryStorageBackend (slice 2)', 'not-implemented');
  }
  async deleteWorkspace(_id: WorkspaceId): Promise<void> {
    throw new BackendError('deleteWorkspace() not implemented in InMemoryStorageBackend (slice 2)', 'not-implemented');
  }
  capabilities(): BackendCapabilities {
    // Re-use the git capabilities const so tests don't depend on a fresh constant.
    return GIT_FILESYSTEM_CAPABILITIES;
  }
}
