import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authApi, projectApi, filesystemApi } from '../services/api';
import GitStatusIndicator from './GitStatusIndicator';
import { useAppMode } from '../hooks/useAppMode';

function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'dark';
  });

  // Apply on mount AND when theme changes — must override shell plugin's system preference
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    // Shell plugin may re-apply system theme after our first render;
    // use a MutationObserver to fight back until component unmounts
    const observer = new MutationObserver(() => {
      const current = document.documentElement.getAttribute('data-theme');
      if (current !== theme) {
        document.documentElement.setAttribute('data-theme', theme);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [theme]);

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  return { theme, toggle };
}

interface NavbarProps {
  toggleSidebar: () => void;
  toggleChat?: () => void;
  chatOpen?: boolean;
}

const RECENT_KEY = 'smart-data-dico-recent-projects';

const Navbar = ({ toggleSidebar, toggleChat, chatOpen }: NavbarProps) => {
  const [isAuthenticated, setIsAuthenticated] = useState(authApi.isAuthenticated());
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  const { mode } = useAppMode();

  // Project state (#95)
  const [projectName, setProjectName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [projectOpen, setProjectOpen] = useState(true);
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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleLogout = () => {
    authApi.logout();
    setIsAuthenticated(false);
    navigate('/login');
  };

  return (
    <div className="navbar bg-primary text-primary-content shadow-md min-h-0 h-10 px-2">
      <div className="navbar-start">
        {/* Mobile sidebar toggle */}
        <button
          className="btn btn-ghost btn-sm btn-circle md:hidden"
          onClick={toggleSidebar}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </button>

        {/* Logo */}
        <Link to="/" className="btn btn-ghost btn-sm normal-case text-base font-bold px-2">
          Data Dictionary
        </Link>

        {/* Project indicator (#95) */}
        {projectName && (
          <div className="relative ml-1">
            <button
              className="btn btn-ghost btn-sm normal-case gap-1.5 text-primary-content hover:bg-primary-focus"
              onClick={() => setShowProjectMenu(!showProjectMenu)}
              title={projectPath}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              <span className="font-semibold">{projectName}</span>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 opacity-70" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {showProjectMenu && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-base-100 text-base-content border border-base-300 rounded-lg shadow-lg min-w-[280px] p-2">
                <div className="text-xs text-base-content/50 px-2 py-1 truncate" title={projectPath}>
                  {projectPath}
                </div>
                <div className="divider my-1" />
                <button className="btn btn-ghost btn-sm btn-block justify-start gap-2" onClick={() => { setShowProjectMenu(false); setShowPathInput('open'); setPathInput(''); setProjectError(''); }}>
                  Open Project...
                </button>
                <button className="btn btn-ghost btn-sm btn-block justify-start gap-2" onClick={() => { setShowProjectMenu(false); setShowPathInput('init'); setPathInput(''); setProjectError(''); }}>
                  New Project...
                </button>
                <button className="btn btn-ghost btn-sm btn-block justify-start gap-2 text-error" onClick={() => { setShowProjectMenu(false); handleCloseProject(); }}>
                  Close Project
                </button>
                {recentProjects.length > 0 && (
                  <>
                    <div className="divider my-1" />
                    <div className="text-xs text-base-content/50 px-2 py-1">Recent</div>
                    {recentProjects.filter(p => p !== projectPath).slice(0, 5).map(p => (
                      <button key={p} className="btn btn-ghost btn-xs btn-block justify-start truncate font-mono" title={p} onClick={() => handleOpenRecent(p)}>
                        {p.split('/').slice(-2).join('/')}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Path input modal with folder browser (#95) */}
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

      <div className="navbar-end gap-1">
        {/* Git Status + Version Control */}
        <GitStatusIndicator />

        {/* Search */}
        <form onSubmit={handleSearch} className="hidden md:flex">
          <div className="form-control">
            <div className="input-group">
              <input
                type="text"
                placeholder="Search..."
                className="input input-xs input-bordered text-base-content w-36"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button type="submit" className="btn btn-xs btn-square">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
            </div>
          </div>
        </form>

        {/* Mobile search button */}
        <Link to="/search" className="btn btn-ghost btn-sm btn-circle md:hidden">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </Link>

        {/* AI Chat toggle */}
        {toggleChat && (
          <button
            className={`btn btn-ghost btn-sm btn-circle ${chatOpen ? 'text-primary-content bg-primary-focus' : ''}`}
            onClick={toggleChat}
            title="AI Assistant (Cmd+K)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
            </svg>
          </button>
        )}

        {/* Theme toggle */}
        <button
          className="btn btn-ghost btn-sm btn-circle"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
            </svg>
          )}
        </button>

        {/* Admin menu */}
        <div className="dropdown dropdown-end">
          <label tabIndex={0} className="btn btn-ghost btn-sm text-primary-content gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
            <span className="hidden md:inline text-xs">Admin</span>
          </label>
          <ul tabIndex={0} className="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52 text-base-content">
            <li><Link to="/stereotypes">Stereotypes</Link></li>
            <li><Link to="/import-export">Import / Export</Link></li>
            <li className="border-t border-base-300 mt-1 pt-1">
              <Link to="/version/history">Version History</Link>
            </li>
            <li><Link to="/version/commit">Manual Commit</Link></li>
          </ul>
        </div>

        {/* User menu — server mode only */}
        {mode === 'server' && <div className="dropdown dropdown-end">
          <label tabIndex={0} className="btn btn-ghost btn-sm btn-circle avatar">
            <div className="w-7 rounded-full bg-primary-focus flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
          </label>
          <ul tabIndex={0} className="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52 text-base-content">
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
        </div>}
      </div>
    </div>
  );
};

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
            ? 'Browse to a folder containing data-dictionaries/, or type a path'
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
                      {dir === 'data-dictionaries' && (
                        <span className="badge badge-xs badge-success ml-1">project</span>
                      )}
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
            data-dictionaries structure found
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
