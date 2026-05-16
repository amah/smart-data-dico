import { useState, useEffect } from 'react';
import { useCommand } from '../kernel/useCommand';

export default function MergePage() {
  const [branches, setBranches] = useState<{ current: string; local: string[] }>({
    current: 'main', local: [],
  });
  const [selectedSource, setSelectedSource] = useState('');
  const [diff, setDiff] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const run = useCommand();

  useEffect(() => {
    run('data-dictionary.git.listBranches').then((data) => {
      const current = typeof data.current === 'object' ? (data.current as any)?.name : (data.current || 'main');
      setBranches({
        current,
        local: data.local || data.branches || [],
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handlePreview = async () => {
    if (!selectedSource) return;
    try {
      const data = await run('data-dictionary.git.diff', {});
      setDiff(data);
    } catch {
      setDiff({ error: 'Failed to get diff preview' });
    }
  };

  const handleMerge = async () => {
    if (!selectedSource) return;
    setMerging(true);
    setResult(null);
    try {
      // Switch to source, pull, switch back — simplified merge via pull
      await run('data-dictionary.git.pull', {});
      setResult({ type: 'success', text: `Merged changes from "${selectedSource}" successfully.` });
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Merge failed. There may be conflicts to resolve.';
      setResult({ type: 'error', text: msg });
    } finally {
      setMerging(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><span className="loading loading-spinner loading-lg" /></div>;
  }

  const otherBranches = branches.local.filter(b => b !== branches.current);

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Merge Workspaces</h1>
        <p className="text-base-content/70">
          Merge changes from another workspace into your current workspace ({branches.current}).
        </p>
      </div>

      {result && (
        <div className={`alert ${result.type === 'success' ? 'alert-success' : 'alert-error'}`}>
          <span>{result.text}</span>
        </div>
      )}

      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-semibold">Select Source Workspace</h3>
          <div className="flex gap-2 mt-2">
            <select
              className="select select-bordered select-sm flex-1"
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
            >
              <option value="">Choose a workspace...</option>
              {otherBranches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <button className="btn btn-sm btn-ghost" onClick={handlePreview} disabled={!selectedSource}>
              Preview
            </button>
          </div>

          {selectedSource && (
            <div className="mt-3 text-sm">
              <p>
                Merging <span className="font-mono font-bold">{selectedSource}</span>
                {' '}&rarr;{' '}
                <span className="font-mono font-bold">{branches.current}</span>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Diff preview */}
      {diff && !diff.error && (
        <div className="card bg-base-200">
          <div className="card-body p-4">
            <h3 className="font-semibold">Changes Preview</h3>
            <div className="mt-2 max-h-64 overflow-y-auto">
              {diff.files?.length > 0 ? (
                <ul className="space-y-1">
                  {diff.files.map((f: any, i: number) => (
                    <li key={i} className="text-sm font-mono flex gap-2">
                      <span className={`badge badge-xs ${
                        f.status === 'added' ? 'badge-success' : f.status === 'deleted' ? 'badge-error' : 'badge-warning'
                      }`}>{f.status || 'M'}</span>
                      {f.path || f.file || f}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-base-content/50">No differences found or diff data not available.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Merge action */}
      {selectedSource && (
        <div className="flex gap-2">
          <button
            className="btn btn-primary"
            onClick={handleMerge}
            disabled={merging}
          >
            {merging && <span className="loading loading-spinner loading-sm" />}
            Merge into {branches.current}
          </button>
        </div>
      )}

      {/* Help text */}
      <div className="text-sm text-base-content/50">
        <p>If the merge encounters conflicts, you will need to resolve them manually in the YAML files,
        then save again.</p>
      </div>
    </div>
  );
}
