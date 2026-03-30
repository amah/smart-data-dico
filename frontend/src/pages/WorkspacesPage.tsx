import { useState, useEffect } from 'react';
import { gitApi } from '../services/api';

export default function WorkspacesPage() {
  const [branches, setBranches] = useState<{ current: string; local: string[]; remote: string[] }>({
    current: 'main', local: [], remote: [],
  });
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchBranches = async () => {
    try {
      setLoading(true);
      const data = await gitApi.getBranches();
      const currentBranch = typeof data.current === 'object' ? data.current?.name : (data.current || data.branch || 'main');
      setBranches({
        current: currentBranch,
        local: data.local || data.branches || data.all || [],
        remote: data.remote || [],
      });
    } catch {
      setError('Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBranches(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const branchName = `workspace/${newName.trim().replace(/\s+/g, '-').toLowerCase()}`;
    setCreating(true);
    setError(null);
    try {
      await gitApi.checkout(branchName, true);
      setSuccess(`Workspace "${newName}" created and activated.`);
      setNewName('');
      fetchBranches();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create workspace');
    } finally {
      setCreating(false);
    }
  };

  const handleSwitch = async (branch: string) => {
    setError(null);
    try {
      await gitApi.checkout(branch);
      setSuccess(`Switched to "${friendlyName(branch)}".`);
      fetchBranches();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to switch workspace');
    }
  };

  const friendlyName = (branch: string) =>
    branch.startsWith('workspace/') ? branch.replace('workspace/', '') : branch;

  const isWorkspace = (branch: string) => branch.startsWith('workspace/');

  if (loading) {
    return <div className="flex items-center justify-center h-64"><span className="loading loading-spinner loading-lg" /></div>;
  }

  const workspaceBranches = branches.local.filter(isWorkspace);
  const mainBranches = branches.local.filter(b => !isWorkspace(b));

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Workspaces</h1>
        <p className="text-base-content/70">Work in isolated workspaces, then publish when ready.</p>
      </div>

      {error && <div className="alert alert-error"><span>{error}</span></div>}
      {success && <div className="alert alert-success"><span>{success}</span></div>}

      {/* Current workspace */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-semibold">Current Workspace</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="font-mono text-lg">{friendlyName(branches.current)}</span>
            {branches.current === 'main' && <span className="badge badge-primary badge-sm">shared</span>}
            {isWorkspace(branches.current) && <span className="badge badge-info badge-sm">workspace</span>}
          </div>
        </div>
      </div>

      {/* Create new workspace */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-semibold">Create New Workspace</h3>
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              className="input input-bordered input-sm flex-1"
              placeholder="Workspace name (e.g. billing-v2)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button className="btn btn-sm btn-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating && <span className="loading loading-spinner loading-xs" />}
              Create
            </button>
          </div>
          <p className="text-xs text-base-content/60 mt-1">Will create: workspace/{newName.trim().replace(/\s+/g, '-').toLowerCase() || '...'}</p>
        </div>
      </div>

      {/* Workspace list */}
      {workspaceBranches.length > 0 && (
        <div>
          <h3 className="font-semibold mb-2">Your Workspaces</h3>
          <div className="space-y-2">
            {workspaceBranches.map((b) => (
              <div key={b} className="flex items-center justify-between p-3 bg-base-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="font-mono">{friendlyName(b)}</span>
                  {b === branches.current && <span className="badge badge-success badge-xs">active</span>}
                </div>
                {b !== branches.current && (
                  <button className="btn btn-xs btn-ghost" onClick={() => handleSwitch(b)}>
                    Switch
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main branches */}
      <div>
        <h3 className="font-semibold mb-2">Shared Branches</h3>
        <div className="space-y-2">
          {mainBranches.map((b) => (
            <div key={b} className="flex items-center justify-between p-3 bg-base-200 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="font-mono">{b}</span>
                {b === branches.current && <span className="badge badge-success badge-xs">active</span>}
                {b === 'main' && <span className="badge badge-primary badge-xs">default</span>}
              </div>
              {b !== branches.current && (
                <button className="btn btn-xs btn-ghost" onClick={() => handleSwitch(b)}>
                  Switch
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
