export interface BackendCapabilities {
  versionControl: boolean;
  branches: boolean;
  pullRequests: boolean;
  timeTravel: boolean;
  threeWayMerge: boolean;
  concurrency: 'branch-isolation' | 'optimistic-etag' | 'pessimistic-lock' | 'mvcc' | 'single-user';
  nativeSearch: boolean;
  nativeTraversal: boolean;
  nativeImpact: boolean;
  nativeLineage: boolean;
  fullTextSearch: boolean;
  multiUser:
    | 'workspace-per-user'
    | 'shared-with-locks'
    | 'shared-with-mvcc'
    | 'shared-with-etag'
    | 'single-user';
  maxFileSize?: number;
  maxWorkspaces?: number;
}

// Capabilities reflect what THIS SLICE actually implements, not the eventual
// target. Slice 4 (per-user worktrees, #169) flips branches/pullRequests/
// threeWayMerge/multiUser. UI consumers must see honest values, otherwise
// capability-gated features would activate before their backend support lands.
export const GIT_FILESYSTEM_CAPABILITIES: BackendCapabilities = {
  versionControl: true,           // git plugin (#160) still owns commit/history
  branches: false,                // forkWorkspace throws — no branch creation via backend yet
  pullRequests: false,            // mergeWorkspace throws — no submit/review yet
  timeTravel: false,              // no read-at-version method in contract slice 1
  threeWayMerge: false,           // implied by mergeWorkspace throwing
  concurrency: 'single-user',     // no per-user workspace isolation yet
  nativeSearch: false,
  nativeTraversal: false,
  nativeImpact: false,
  nativeLineage: false,
  fullTextSearch: false,
  multiUser: 'single-user',       // flips to 'workspace-per-user' in #169 slice
};
