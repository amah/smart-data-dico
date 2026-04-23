import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi, projectApi, filesystemApi } from '../services/api';
import GitStatusIndicator from './GitStatusIndicator';
import { useAppMode } from '../hooks/useAppMode';
import { usePrefs } from '../hooks/usePrefs';
import { Icon, DensitySwitcher } from './ui';

interface NavbarProps {
  toggleSidebar: () => void;
  toggleChat?: () => void;
  chatOpen?: boolean;
}

const RECENT_KEY = 'smart-data-dico-recent-projects';

const Navbar = ({ toggleSidebar, toggleChat, chatOpen }: NavbarProps) => {
  const [isAuthenticated, setIsAuthenticated] = useState(authApi.isAuthenticated());
  const navigate = useNavigate();
  const { theme, toggleTheme, density, setDensity, variant, setVariant } = usePrefs();
  const { mode } = useAppMode();

  // Project state (#95)
  const [projectName, setProjectName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [, setProjectOpen] = useState(true);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showPathInput, setShowPathInput] = useState<'open' | 'init' | null>(null);
  const [pathInput, setPathInput] = useState('');
  const [projectError, setProjectError] = useState('');
  const [recentProjects, setRecentProjects] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
  });

  const loadProject = useCallback(async () => {
    try {
      const info = await projectApi.get();
      setProjectName(info.name);
      setProjectPath(info.path);
      setProjectOpen(info.isOpen);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadProject(); }, [loadProject]);

  const addRecent = (p: string) => {
    const updated = [p, ...recentProjects.filter(r => r !== p)].slice(0, 8);
    setRecentProjects(updated);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  };

  const confirmIfDirty = async (action: string): Promise<boolean> => {
    try {
      const status = await projectApi.status();
      if (status.clean) return true;
      const n = status.files.length;
      return window.confirm(
        `You have ${n} uncommitted change${n === 1 ? '' : 's'} in the current project.\n\n` +
        `${action} will leave them behind (they remain on disk but won't be tracked by the new project). ` +
        `Commit or discard them first?\n\nProceed anyway?`,
      );
    } catch {
      return true;
    }
  };

  const handleOpenProject = async () => {
    setProjectError('');
    if (!(await confirmIfDirty('Opening a different project'))) return;
    try {
      await projectApi.open(pathInput);
      addRecent(pathInput);
      setShowPathInput(null);
      setPathInput('');
      loadProject();
      window.location.reload();
    } catch (e: any) {
      setProjectError(e.response?.data?.message || 'Failed to open project');
    }
  };

  const handleInitProject = async () => {
    setProjectError('');
    if (!(await confirmIfDirty('Initializing a new project'))) return;
    try {
      await projectApi.init(pathInput);
      addRecent(pathInput);
      setShowPathInput(null);
      setPathInput('');
      loadProject();
      window.location.reload();
    } catch (e: any) {
      setProjectError(e.response?.data?.message || 'Failed to init project');
    }
  };

  const handleCloseProject = async () => {
    if (!(await confirmIfDirty('Closing the project'))) return;
    try {
      await projectApi.close();
      loadProject();
      window.location.reload();
    } catch { /* ignore */ }
  };

  const handleOpenRecent = async (p: string) => {
    if (!(await confirmIfDirty('Switching project'))) return;
    try {
      await projectApi.open(p);
      addRecent(p);
      setShowProjectMenu(false);
      loadProject();
      window.location.reload();
    } catch { /* ignore */ }
  };

  const handleLogout = () => {
    authApi.logout();
    setIsAuthenticated(false);
    navigate('/login');
  };

  return (
    <div
      style={{
        height: 48,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 12px',
        background: 'var(--bg-raised)',
        borderBottom: '1px solid var(--border)',
        color: 'var(--text)',
        flexShrink: 0,
      }}
    >
      {/* Mobile sidebar toggle */}
      <button
        className="md:hidden"
        onClick={toggleSidebar}
        aria-label="Open navigation"
        style={{
          background: 'transparent', border: 'none', padding: 6, borderRadius: 'var(--radius-sm)',
          color: 'var(--text-muted)', display: 'grid', placeItems: 'center', cursor: 'pointer',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
        </svg>
      </button>

      {/* Product mark + breadcrumb */}
      <Link
        to="/"
        title="Home"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          textDecoration: 'none', color: 'var(--text)',
        }}
      >
        <span
          className="mono"
          style={{
            width: 20, height: 20, borderRadius: 'var(--radius-sm)',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            display: 'grid', placeItems: 'center',
            fontSize: 11, fontWeight: 600, letterSpacing: '-0.02em',
          }}
        >
          DD
        </span>
        <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600, letterSpacing: '-0.01em' }}>
          Dictionary
        </span>
      </Link>

      {/* Project picker (#95) — preserved; dressed to match grammar */}
      {projectName && (
        <>
          <span style={{ color: 'var(--text-subtle)' }}>/</span>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowProjectMenu(!showProjectMenu)}
              title={projectPath}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: 'transparent', border: 'none',
                color: 'var(--text-muted)', fontSize: 'var(--fs-sm)',
                padding: '4px 6px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon name="folder" size={13} />
              <span style={{ fontWeight: 500, color: 'var(--text)' }}>{projectName}</span>
              <Icon name="chevron" size={11} />
            </button>

            {showProjectMenu && (
              <div
                style={{
                  position: 'absolute', left: 0, top: '100%', marginTop: 4,
                  zIndex: 50, minWidth: 280,
                  background: 'var(--bg-raised)', color: 'var(--text)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-md)',
                  padding: 4,
                }}
              >
                <div
                  title={projectPath}
                  className="mono"
                  style={{
                    fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)',
                    padding: '6px 8px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {projectPath}
                </div>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                <MenuItem onClick={() => { setShowProjectMenu(false); setShowPathInput('open'); setPathInput(''); setProjectError(''); }}>
                  Open Project…
                </MenuItem>
                <MenuItem onClick={() => { setShowProjectMenu(false); setShowPathInput('init'); setPathInput(''); setProjectError(''); }}>
                  New Project…
                </MenuItem>
                <MenuItem tone="danger" onClick={() => { setShowProjectMenu(false); handleCloseProject(); }}>
                  Close Project
                </MenuItem>
                {recentProjects.filter(p => p !== projectPath).length > 0 && (
                  <>
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                    <div
                      className="uppercase"
                      style={{
                        fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)',
                        letterSpacing: '0.06em', padding: '6px 8px', fontWeight: 600,
                      }}
                    >
                      Recent
                    </div>
                    {recentProjects.filter(p => p !== projectPath).slice(0, 5).map(p => (
                      <MenuItem key={p} mono onClick={() => handleOpenRecent(p)}>
                        {p.split('/').slice(-2).join('/')}
                      </MenuItem>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Folder picker modal (#95) */}
      {showPathInput && (
        <FolderPickerModal
          mode={showPathInput}
          pathInput={pathInput}
          setPathInput={setPathInput}
          error={projectError}
          onConfirm={showPathInput === 'open' ? handleOpenProject : handleInitProject}
          onCancel={() => setShowPathInput(null)}
        />
      )}

      {/* Center — ⌘K launcher */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <button
          onClick={() => navigate('/search')}
          className="hidden md:flex"
          style={{
            alignItems: 'center', gap: 8,
            padding: '4px 10px',
            width: 360, maxWidth: '50%', height: 32,
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-subtle)',
            fontSize: 'var(--fs-sm)',
            textAlign: 'left', cursor: 'pointer',
          }}
        >
          <Icon name="search" size={13} />
          <span style={{ flex: 1 }}>Search entities, attributes, rules…</span>
          <span
            className="mono"
            style={{
              fontSize: 10, color: 'var(--text-subtle)',
              padding: '1px 5px',
              border: '1px solid var(--border)',
              borderRadius: 2,
            }}
          >
            ⌘K
          </span>
        </button>
      </div>

      {/* Right-side controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <GitStatusIndicator />

        {/* Mobile search shortcut */}
        <Link
          to="/search"
          className="md:hidden"
          aria-label="Search"
          style={{
            padding: 6, borderRadius: 'var(--radius-sm)',
            color: 'var(--text-muted)', display: 'grid', placeItems: 'center',
          }}
        >
          <Icon name="search" size={14} />
        </Link>

        {toggleChat && (
          <button
            onClick={toggleChat}
            title="AI Assistant"
            aria-pressed={!!chatOpen}
            style={{
              background: chatOpen ? 'var(--accent-soft)' : 'transparent',
              color: chatOpen ? 'var(--accent)' : 'var(--text-muted)',
              border: 'none',
              padding: 6, borderRadius: 'var(--radius-sm)',
              display: 'grid', placeItems: 'center', cursor: 'pointer',
            }}
          >
            <Icon name="sparkle" size={14} />
          </button>
        )}

        <DensitySwitcher value={density} onChange={setDensity} />

        {/* Variant switcher — cycles calm ↔ bold. Bold is the handoff's
            dev-tool dark palette; Calm is the default warm neutral. */}
        <button
          onClick={() => setVariant(variant === 'bold' ? 'calm' : 'bold')}
          title={`Switch to ${variant === 'bold' ? 'Calm' : 'Bold'} variant`}
          aria-label="Toggle variant"
          style={{
            background: variant === 'bold' ? 'var(--accent-soft)' : 'transparent',
            color: variant === 'bold' ? 'var(--accent)' : 'var(--text-muted)',
            border: 'none',
            padding: 6,
            borderRadius: 'var(--radius-sm)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
            fontSize: 'var(--fs-xs)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 500,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <Icon name="sparkle" size={11} />
          {variant === 'bold' ? 'bold' : 'calm'}
        </button>

        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle theme"
          disabled={variant === 'bold'}
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--text-muted)', padding: 6,
            borderRadius: 'var(--radius-sm)',
            display: 'grid', placeItems: 'center',
            cursor: variant === 'bold' ? 'not-allowed' : 'pointer',
            opacity: variant === 'bold' ? 0.35 : 1,
          }}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
        </button>

        {/* Admin menu — DaisyUI dropdown; tokens give it the Calm palette automatically */}
        <div className="dropdown dropdown-end">
          <label
            tabIndex={0}
            title="Admin"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: 6, borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            <Icon name="gear" size={14} />
          </label>
          <ul
            tabIndex={0}
            className="menu menu-sm dropdown-content mt-1 z-[50] p-2 shadow bg-base-100 rounded-box w-52 text-base-content"
          >
            <li><Link to="/stereotypes">Stereotypes</Link></li>
            <li><Link to="/import-export">Import / Export</Link></li>
            <li className="border-t border-base-300 mt-1 pt-1">
              <Link to="/version/history">Version History</Link>
            </li>
            <li><Link to="/version/commit">Manual Commit</Link></li>
          </ul>
        </div>

        {/* User menu — server mode only */}
        {mode === 'server' && (
          <div className="dropdown dropdown-end">
            <label
              tabIndex={0}
              aria-label="Account"
              style={{
                width: 22, height: 22, borderRadius: '50%',
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border)',
                display: 'grid', placeItems: 'center',
                fontSize: 10, fontWeight: 600,
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              <Icon name="home" size={11} />
            </label>
            <ul
              tabIndex={0}
              className="menu menu-sm dropdown-content mt-1 z-[50] p-2 shadow bg-base-100 rounded-box w-52 text-base-content"
            >
              {isAuthenticated ? (
                <>
                  <li><Link to="/profile">Profile</Link></li>
                  <li><Link to="/settings">Settings</Link></li>
                  <li><button onClick={handleLogout}>Logout</button></li>
                </>
              ) : (
                <>
                  <li><Link to="/login">Login</Link></li>
                  <li><Link to="/register">Register</Link></li>
                </>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

// Lightweight menu-item row used inside the project picker dropdown.
// Kept local to avoid prematurely committing to a shared <MenuItem/> shape.
function MenuItem({
  children, onClick, tone, mono,
}: { children: React.ReactNode; onClick: () => void; tone?: 'danger'; mono?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={mono ? 'mono' : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        width: '100%', textAlign: 'left',
        background: 'transparent', border: 'none',
        padding: '5px 8px',
        fontSize: 'var(--fs-sm)',
        color: tone === 'danger' ? 'var(--danger)' : 'var(--text)',
        borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Folder picker modal (#95) — server-side directory browsing
// ────────────────────────────────────────────────────────────────────────

function FolderPickerModal({
  mode,
  pathInput,
  setPathInput,
  error,
  onConfirm,
  onCancel,
}: {
  mode: 'open' | 'init';
  pathInput: string;
  setPathInput: (v: string) => void;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [browsePath, setBrowsePath] = useState('');
  const [directories, setDirectories] = useState<string[]>([]);
  const [parentPath, setParentPath] = useState('');
  const [hasDataDic, setHasDataDic] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);

  const browse = useCallback(async (dir?: string) => {
    setBrowseLoading(true);
    try {
      const result = await filesystemApi.browse(dir);
      setBrowsePath(result.path);
      setParentPath(result.parent);
      setDirectories(result.directories);
      setHasDataDic(result.hasDataDictionaries);
      setPathInput(result.path);
    } catch { /* ignore */ }
    setBrowseLoading(false);
  }, [setPathInput]);

  useEffect(() => { browse(); }, [browse]);

  return (
    <dialog className="modal modal-open" style={{ zIndex: 9999 }}>
      <div className="modal-box max-w-lg">
        <h3 className="font-bold text-lg">
          {mode === 'open' ? 'Open Project' : 'New Project'}
        </h3>
        <p className="text-sm text-base-content/70 mt-1">
          {mode === 'open'
            ? 'Browse to a project folder containing dico.config.json, or type a path'
            : 'Browse to a folder where the new project should be created'}
        </p>
        {error && <div className="alert alert-error mt-2 py-2 text-sm">{error}</div>}

        {/* Path text input */}
        <div className="form-control mt-3">
          <div className="input-group">
            <input
              type="text"
              className="input input-bordered font-mono text-sm flex-1"
              placeholder="/Users/me/projects/my-dictionary"
              value={pathInput}
              onChange={e => setPathInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') onConfirm();
              }}
            />
            <button className="btn btn-square btn-outline" onClick={() => browse(pathInput)} title="Browse this path">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Folder browser */}
        <div className="border border-base-300 rounded-lg mt-3 max-h-64 overflow-y-auto">
          {browseLoading ? (
            <div className="flex justify-center py-4">
              <span className="loading loading-spinner loading-sm" />
            </div>
          ) : (
            <ul className="menu menu-compact p-1">
              {/* Current path */}
              <li className="menu-title">
                <span className="text-xs font-mono truncate" title={browsePath}>{browsePath}</span>
              </li>
              {/* Up to parent */}
              {parentPath !== browsePath && (
                <li>
                  <button className="text-sm py-1" onClick={() => browse(parentPath)}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                    ..
                  </button>
                </li>
              )}
              {/* Subdirectories */}
              {directories.map(dir => {
                const fullPath = browsePath + '/' + dir;
                return (
                  <li key={dir}>
                    <button
                      className="text-sm py-1"
                      onClick={() => browse(fullPath)}
                      onDoubleClick={() => { setPathInput(fullPath); onConfirm(); }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      {dir}
                    </button>
                  </li>
                );
              })}
              {directories.length === 0 && (
                <li className="text-xs text-base-content/50 px-4 py-2">No subdirectories</li>
              )}
            </ul>
          )}
        </div>

        {/* Status hint */}
        {hasDataDic && mode === 'open' && (
          <div className="text-sm text-success mt-2 flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            dico.config.json found — project folder
          </div>
        )}

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={!pathInput.trim()}
          >
            {mode === 'open' ? 'Open' : 'Create & Open'}
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop"><button onClick={onCancel}>close</button></form>
    </dialog>
  );
}

export default Navbar;
