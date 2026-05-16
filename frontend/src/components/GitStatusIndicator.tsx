import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useCommand } from '../kernel/useCommand';
import { Button, Chip, Icon, Menu } from './ui';

interface GitStatus {
  branch?: string;
  ahead?: number;
  behind?: number;
  hasUncommittedChanges?: boolean;
  files?: { path: string; status: string }[];
}

/**
 * Top-bar workspace / git status pill. Shows the current branch + a
 * tri-state indicator (clean / unsaved / ahead / behind) and opens a
 * Menu with Save / Publish / Sync / workspace links.
 *
 * See /design-system → Menu, Chip.
 */
export default function GitStatusIndicator() {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const run = useCommand();

  const fetchStatus = async () => {
    try {
      const data = await run('data-dictionary.git.getStatus');
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
    try { await run('data-dictionary.git.pull', {}); fetchStatus(); } catch { /* ignore */ } finally { setSyncing(false); }
  };

  const handlePush = async () => {
    setSyncing(true);
    try { await run('data-dictionary.git.push', {}); fetchStatus(); } catch { /* ignore */ } finally { setSyncing(false); }
  };

  if (!status) return null;

  const unsavedCount = status.files?.length || 0;
  const ahead = status.ahead || 0;
  const behind = status.behind || 0;
  const isClean = !status.hasUncommittedChanges && ahead === 0 && behind === 0;

  const titleParts: string[] = [`Workspace: ${status.branch || 'main'}`];
  if (unsavedCount > 0) titleParts.push(`${unsavedCount} unsaved`);
  if (ahead > 0) titleParts.push(`↑${ahead} ahead of shared`);
  if (behind > 0) titleParts.push(`↓${behind} updates available`);
  if (isClean) titleParts.push('clean');
  const triggerTitle = titleParts.join(' · ');

  return (
    <Menu
      align="end"
      width={260}
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={open}
          title={triggerTitle}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            height: 28,
            background: open ? 'var(--bg-active)' : 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: 'var(--fs-sm)',
          }}
          onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent'; }}
        >
          <Icon name="branch" size={13} />
          <span className="mono" style={{ color: 'var(--text)', fontSize: 'var(--fs-xs)' }}>
            {status.branch || 'main'}
          </span>
          {isClean ? (
            <Icon name="check" size={12} style={{ color: 'var(--success)' }} />
          ) : (
            <span style={{ display: 'inline-flex', gap: 3 }}>
              {unsavedCount > 0 && <Chip tone="warning" soft>{unsavedCount}</Chip>}
              {ahead > 0 && <Chip tone="info" soft>↑{ahead}</Chip>}
              {behind > 0 && <Chip tone="danger" soft>↓{behind}</Chip>}
            </span>
          )}
        </button>
      )}
    >
      {({ close }) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>
            Workspace:{' '}
            <span className="mono" style={{ color: 'var(--text-muted)' }}>{status.branch}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 'var(--fs-xs)' }}>
            {unsavedCount > 0 && (
              <span style={{ color: 'var(--warning)' }}>
                {unsavedCount} unsaved change{unsavedCount > 1 ? 's' : ''}
              </span>
            )}
            {ahead > 0 && (
              <span style={{ color: 'var(--accent)' }}>
                {ahead} save{ahead > 1 ? 's' : ''} ahead of shared
              </span>
            )}
            {behind > 0 && (
              <span style={{ color: 'var(--danger)' }}>
                {behind} update{behind > 1 ? 's' : ''} available
              </span>
            )}
            {isClean && <span style={{ color: 'var(--success)' }}>Up to date</span>}
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            <Link to="/version/save" onClick={close} style={{ flex: 1 }}>
              <Button size="sm" variant="primary" icon="check" style={{ width: '100%' }}>Save</Button>
            </Link>
            <Button size="sm" variant="secondary" onClick={handlePush} disabled={syncing} style={{ flex: 1 }}>
              {syncing ? '…' : 'Publish'}
            </Button>
            <Button size="sm" variant="ghost" onClick={handlePull} disabled={syncing} style={{ flex: 1 }}>
              Sync
            </Button>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <MenuLink to="/version/save" onClick={close}>Save &amp; Publish</MenuLink>
            <MenuLink to="/version/workspaces" onClick={close}>Workspaces</MenuLink>
            <MenuLink to="/version/merge" onClick={close}>Merge</MenuLink>
            <MenuLink to="/version/history" onClick={close}>History</MenuLink>
          </div>
        </div>
      )}
    </Menu>
  );
}

const MenuLink = ({ to, onClick, children }: { to: string; onClick: () => void; children: React.ReactNode }) => (
  <Link
    to={to}
    onClick={onClick}
    style={{
      padding: '4px 8px',
      fontSize: 'var(--fs-sm)',
      color: 'var(--text)',
      textDecoration: 'none',
      borderRadius: 'var(--radius-sm)',
    }}
    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
  >
    {children}
  </Link>
);
