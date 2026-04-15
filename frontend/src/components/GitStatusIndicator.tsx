import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { gitApi } from '../services/api';

interface GitStatus {
  branch?: string;
  ahead?: number;
  behind?: number;
  hasUncommittedChanges?: boolean;
  files?: { path: string; status: string }[];
}

export default function GitStatusIndicator() {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fetchStatus = async () => {
    try {
      const data = await gitApi.getStatus();
      // Framework returns branch as object {current, tracking, ahead, behind} or as string
      const branchInfo = typeof data.branch === 'object' ? data.branch : null;
      setStatus({
        branch: branchInfo?.current || (typeof data.branch === 'string' ? data.branch : data.current) || 'main',
        ahead: branchInfo?.ahead || data.ahead || 0,
        behind: branchInfo?.behind || data.behind || 0,
        hasUncommittedChanges: data.hasUncommittedChanges ?? (data.files?.length > 0),
        files: data.files || [],
      });
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const handlePull = async () => {
    setSyncing(true);
    try { await gitApi.pull(); fetchStatus(); } catch {} finally { setSyncing(false); }
  };

  const handlePush = async () => {
    setSyncing(true);
    try { await gitApi.push(); fetchStatus(); } catch {} finally { setSyncing(false); }
  };

  if (!status) return null;

  const unsavedCount = status.files?.length || 0;
  const isClean = !status.hasUncommittedChanges && status.ahead === 0 && status.behind === 0;

  return (
    <div className="dropdown dropdown-end">
      <button
        className="btn btn-ghost btn-sm gap-1 text-primary-content"
        onClick={() => setOpen(!open)}
        title={(() => {
          const parts: string[] = [`Workspace: ${status.branch || 'main'}`];
          if (unsavedCount > 0) parts.push(`${unsavedCount} unsaved`);
          if ((status.ahead || 0) > 0) parts.push(`↑${status.ahead} ahead of shared`);
          if ((status.behind || 0) > 0) parts.push(`↓${status.behind} updates available`);
          if (isClean) parts.push('clean');
          return parts.join(' · ');
        })()}
      >
        {/* Branch icon */}
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <span className="text-xs font-mono">{status.branch || 'main'}</span>

        {/* Status indicator */}
        {isClean ? (
          <span className="text-success text-xs">&#10003;</span>
        ) : (
          <span className="flex gap-0.5">
            {unsavedCount > 0 && <span className="badge badge-xs badge-warning">{unsavedCount}</span>}
            {(status.ahead || 0) > 0 && <span className="badge badge-xs badge-info">&uarr;{status.ahead}</span>}
            {(status.behind || 0) > 0 && <span className="badge badge-xs badge-error">&darr;{status.behind}</span>}
          </span>
        )}
      </button>

      {open && (
        <div className="dropdown-content z-50 bg-base-200 rounded-box shadow-lg p-3 w-64 mt-1">
          <div className="text-sm font-semibold mb-2">Workspace: {status.branch}</div>

          <div className="space-y-1 text-xs mb-3">
            {unsavedCount > 0 && (
              <div className="text-warning">{unsavedCount} unsaved change{unsavedCount > 1 ? 's' : ''}</div>
            )}
            {(status.ahead || 0) > 0 && (
              <div className="text-info">{status.ahead} save{status.ahead! > 1 ? 's' : ''} ahead of shared</div>
            )}
            {(status.behind || 0) > 0 && (
              <div className="text-error">{status.behind} update{status.behind! > 1 ? 's' : ''} available</div>
            )}
            {isClean && <div className="text-success">Up to date</div>}
          </div>

          <div className="flex gap-1">
            <Link to="/version/save" className="btn btn-xs btn-primary flex-1" onClick={() => setOpen(false)}>
              Save
            </Link>
            <button className="btn btn-xs btn-outline flex-1" onClick={handlePush} disabled={syncing}>
              {syncing ? <span className="loading loading-spinner loading-xs" /> : 'Publish'}
            </button>
            <button className="btn btn-xs btn-ghost flex-1" onClick={handlePull} disabled={syncing}>
              Sync
            </button>
          </div>

          <div className="divider my-1" />
          <div className="flex flex-col gap-1">
            <Link to="/version/save" className="btn btn-xs btn-ghost justify-start" onClick={() => setOpen(false)}>
              Save & Publish
            </Link>
            <Link to="/version/workspaces" className="btn btn-xs btn-ghost justify-start" onClick={() => setOpen(false)}>
              Workspaces
            </Link>
            <Link to="/version/merge" className="btn btn-xs btn-ghost justify-start" onClick={() => setOpen(false)}>
              Merge
            </Link>
            <Link to="/version/history" className="btn btn-xs btn-ghost justify-start" onClick={() => setOpen(false)}>
              History
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
