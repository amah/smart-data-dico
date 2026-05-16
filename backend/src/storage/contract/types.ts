/** Workspace identifier. Branded for type safety. */
export type WorkspaceId = string & { readonly __ws: unique symbol };

/** Slash-delimited path relative to the workspace root. Empty string = root. */
export type Path = string & { readonly __path: unique symbol };

/** Bytes payload. UTF-8 string for text, base64 string for binary (slice 1 ships text-only). */
export type Bytes = string;

export interface WriteOpts {
  /** If provided, write fails with ConflictError if current ETag doesn't match. */
  ifMatch?: string;
  /** Create parent directories if missing. Default false. */
  createParents?: boolean;
}

export interface WriteResult {
  path: Path;
  size: number;
  /** ETag for optimistic concurrency. Slice 1: derived from mtime+size. */
  etag: string;
  updatedAt: Date;
}

export interface DirectoryEntry {
  name: string;
  path: Path;
  isDirectory: boolean;
  size: number;
  updatedAt: Date;
}

export interface Stat {
  path: Path;
  isDirectory: boolean;
  size: number;
  createdAt: Date;
  updatedAt: Date;
  etag: string;
}

export type ChangeEventKind = 'created' | 'modified' | 'deleted';
export interface ChangeEvent {
  workspace: WorkspaceId;
  path: Path;
  kind: ChangeEventKind;
  at: Date;
}

export interface WorkspaceHandle {
  id: WorkspaceId;
  /** Backend-specific provenance (e.g. for git: branch name). */
  provenance?: Record<string, unknown>;
}

export interface CreateWorkspaceOpts {
  /** For git: branch start-point (defaults to default branch). */
  from?: WorkspaceId;
}

export interface MergeResult {
  merged: boolean;
  /** Paths with conflicts when merged===false. */
  conflicts: Path[];
  /** Backend-specific commit/version identifier when merged===true. */
  version?: string;
}

// Helper constructors (avoid `as` casts at call sites)
export const wsId = (s: string): WorkspaceId => s as WorkspaceId;
export const pathOf = (s: string): Path => s as Path;
