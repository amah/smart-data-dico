import type {
  WorkspaceId, Path, Bytes, WriteOpts, WriteResult,
  DirectoryEntry, Stat, ChangeEvent, WorkspaceHandle,
  CreateWorkspaceOpts, MergeResult,
} from './types.js';
import type { BackendCapabilities } from './BackendCapabilities.js';

/** Minimal Observable shape. Slice 1 uses an inline type to avoid importing rxjs. */
export interface ChangeObservable {
  subscribe(observer: (event: ChangeEvent) => void): { unsubscribe(): void };
}

export interface IStorageBackend {
  // Read
  read(ws: WorkspaceId, path: Path): Promise<Bytes>;
  list(ws: WorkspaceId, path: Path): Promise<DirectoryEntry[]>;
  stat(ws: WorkspaceId, path: Path): Promise<Stat>;

  // Write
  write(ws: WorkspaceId, path: Path, bytes: Bytes, opts?: WriteOpts): Promise<WriteResult>;
  delete(ws: WorkspaceId, path: Path): Promise<void>;
  mkdir(ws: WorkspaceId, path: Path, parents?: boolean): Promise<void>;

  // Change notification (FRAMEWORK GAP — slice 1 throws 'not-implemented')
  subscribe(ws: WorkspaceId, path: Path): ChangeObservable;

  // Workspaces (FRAMEWORK GAP for create/fork/merge/delete — slice 1 throws 'not-implemented')
  createWorkspace(id: WorkspaceId, opts?: CreateWorkspaceOpts): Promise<WorkspaceHandle>;
  forkWorkspace(srcId: WorkspaceId, destId: WorkspaceId): Promise<WorkspaceHandle>;
  mergeWorkspace(srcId: WorkspaceId, destId: WorkspaceId): Promise<MergeResult>;
  deleteWorkspace(id: WorkspaceId): Promise<void>;

  // Self-description
  capabilities(): BackendCapabilities;
}
