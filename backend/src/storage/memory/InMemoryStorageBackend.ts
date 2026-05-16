// backend/src/storage/memory/InMemoryStorageBackend.ts
import { EventEmitter } from 'events';
import type { IStorageBackend, ChangeObservable } from '../contract/IStorageBackend.js';
import type {
  WorkspaceId, Path, Bytes, WriteOpts, WriteResult,
  DirectoryEntry, Stat, WorkspaceHandle, CreateWorkspaceOpts, MergeResult,
  ChangeEvent,
} from '../contract/types.js';
import { pathOf } from '../contract/types.js';
import { IN_MEMORY_CAPABILITIES, type BackendCapabilities } from '../contract/BackendCapabilities.js';
import { BackendError, NotFoundError } from '../contract/errors.js';

/**
 * In-memory IStorageBackend — promoted from the slice-2 test helper to a
 * first-class backend in slice 3.
 *
 * Storage shape: Map<WorkspaceId, Map<canonicalPath, Bytes>>. Directories
 * are implicit — a "directory" exists iff any stored path starts with
 * `${dir}/`. `mkdir` records the directory so empty dirs are observable.
 *
 * `subscribe()` is implemented via a per-workspace Node EventEmitter with
 * prefix filtering. Workspace-lifecycle methods stay throwing — they are
 * deferred to #169 (per-user worktrees). Capabilities honestly report
 * `versionControl: false` and `branches: false`.
 *
 * Seeding: callers may insert into `backend.files` directly (not via
 * `write()`) to avoid firing `subscribe()` change-events at boot.
 */
export class InMemoryStorageBackend implements IStorageBackend {
  /** Exposed for seeders that want to pre-populate without firing change events. */
  readonly files = new Map<string, Map<string, Bytes>>();
  /** Explicit empty-directory marker set; entries are canonical paths. */
  readonly dirs = new Map<string, Set<string>>();
  private readonly now = () => new Date();

  // ── Per-workspace EventEmitter for subscribe() ──────────────────────────
  private readonly emitters = new Map<string, EventEmitter>();
  private emitterFor(ws: WorkspaceId): EventEmitter {
    const key = String(ws);
    let e = this.emitters.get(key);
    if (!e) { e = new EventEmitter(); this.emitters.set(key, e); }
    return e;
  }

  // ── Internal helpers ─────────────────────────────────────────────────────
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

  // ── Read ─────────────────────────────────────────────────────────────────
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

  // ── Write ────────────────────────────────────────────────────────────────
  async write(ws: WorkspaceId, path: Path, bytes: Bytes, _opts?: WriteOpts): Promise<WriteResult> {
    const c = this.canon(path);
    const existed = this.bucket(ws).has(c);
    this.bucket(ws).set(c, bytes);
    const result: WriteResult = { path, size: bytes.length, etag: `${bytes.length}`, updatedAt: this.now() };
    const event: ChangeEvent = { workspace: ws, path, kind: existed ? 'modified' : 'created', at: result.updatedAt };
    this.emitterFor(ws).emit('change', event);
    return result;
  }

  async delete(ws: WorkspaceId, path: Path): Promise<void> {
    const c = this.canon(path);
    if (!this.bucket(ws).delete(c)) {
      // permissive: also drop a recorded empty dir if present
      if (!this.dirSet(ws).delete(c)) throw new NotFoundError(ws, path);
    }
    const event: ChangeEvent = { workspace: ws, path, kind: 'deleted', at: this.now() };
    this.emitterFor(ws).emit('change', event);
  }

  async mkdir(ws: WorkspaceId, path: Path, _parents?: boolean): Promise<void> {
    const c = this.canon(path);
    if (c) this.dirSet(ws).add(c);
  }

  // ── Change notification ──────────────────────────────────────────────────
  subscribe(ws: WorkspaceId, path: Path): ChangeObservable {
    const emitter = this.emitterFor(ws);
    const prefix = this.canon(path);
    return {
      subscribe(observer: (event: ChangeEvent) => void) {
        const handler = (event: ChangeEvent) => {
          const epc = String(event.path).split('/').filter(Boolean).join('/');
          if (prefix === '' || epc === prefix || epc.startsWith(prefix + '/')) observer(event);
        };
        emitter.on('change', handler);
        return { unsubscribe() { emitter.off('change', handler); } };
      },
    };
  }

  // ── Workspace lifecycle — deferred to #169 ───────────────────────────────
  async createWorkspace(_id: WorkspaceId, _opts?: CreateWorkspaceOpts): Promise<WorkspaceHandle> {
    throw new BackendError('createWorkspace() not implemented in InMemoryStorageBackend', 'not-implemented');
  }
  async forkWorkspace(_s: WorkspaceId, _d: WorkspaceId): Promise<WorkspaceHandle> {
    throw new BackendError('forkWorkspace() not implemented in InMemoryStorageBackend', 'not-implemented');
  }
  async mergeWorkspace(_s: WorkspaceId, _d: WorkspaceId): Promise<MergeResult> {
    throw new BackendError('mergeWorkspace() not implemented in InMemoryStorageBackend', 'not-implemented');
  }
  async deleteWorkspace(_id: WorkspaceId): Promise<void> {
    throw new BackendError('deleteWorkspace() not implemented in InMemoryStorageBackend', 'not-implemented');
  }

  // ── Self-description ─────────────────────────────────────────────────────
  capabilities(): BackendCapabilities {
    return IN_MEMORY_CAPABILITIES;
  }
}
