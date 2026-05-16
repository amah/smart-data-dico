import type { WorkspaceId, Path } from './types.js';

export type BackendErrorCode =
  | 'not-found'
  | 'conflict'
  | 'permission-denied'
  | 'not-implemented'
  | 'invalid-argument'
  | 'internal';

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly code: BackendErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

export class NotFoundError extends BackendError {
  constructor(workspace: WorkspaceId, path: Path, cause?: unknown) {
    super(`Not found: ${workspace}:${path}`, 'not-found', cause);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends BackendError {
  constructor(message: string, cause?: unknown) {
    super(message, 'conflict', cause);
    this.name = 'ConflictError';
  }
}

export class PermissionDeniedError extends BackendError {
  constructor(message: string, cause?: unknown) {
    super(message, 'permission-denied', cause);
    this.name = 'PermissionDeniedError';
  }
}
