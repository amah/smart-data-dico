import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { perspectiveApi } from '../services/api';
import type { ResolvedPerspective } from '../types';
import PerspectiveTreeTable from '../components/PerspectiveTreeTable';

export default function PerspectiveDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [resolved, setResolved] = useState<ResolvedPerspective | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'paths' | 'graph' | 'annotations'>('paths');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    perspectiveApi.resolve(id)
      .then(setResolved)
      .catch(() => setError('Failed to load perspective'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    if (!id || !confirm('Delete this perspective?')) return;
    try {
      await perspectiveApi.delete(id);
      navigate('/perspectives');
    } catch {
      setError('Failed to delete');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><span className="loading loading-spinner loading-lg" /></div>;
  }

  if (error || !resolved) {
    return <div className="p-6"><div className="alert alert-error"><span>{error || 'Not found'}</span></div></div>;
  }

  const rootNodes = resolved.resolvedNodes.filter((n) => n.isRoot);
  const frontierNodes = resolved.resolvedNodes.filter((n) => n.isFrontier);
  const annotations = resolved.nodes?.filter((n) => n.metadata && n.metadata.length > 0) || [];

  return (
    <div className="p-4 space-y-3">
      {/* Compact header: title + description inline + stats + actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <h1 className="text-xl font-bold whitespace-nowrap">{resolved.name}</h1>
          {resolved.description && (
            <span className="text-sm text-base-content/60 truncate max-w-md" title={resolved.description}>
              {resolved.description}
            </span>
          )}
          <span className="text-xs text-base-content/50">
            <b>{rootNodes.length}</b> roots · <b>{resolved.resolvedNodes.length}</b> resolved · <b>{frontierNodes.length}</b> frontier · <b>{annotations.length}</b> annotations
          </span>
        </div>
        <div className="flex gap-2">
          <Link to={`/perspectives/${id}/edit`} className="btn btn-sm btn-ghost">Edit</Link>
          <button className="btn btn-sm btn-error btn-ghost" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      {/* Tabs */}
      <div>
        <div className="tabs tabs-bordered">
          <button className={`tab ${activeTab === 'paths' ? 'tab-active' : ''}`} onClick={() => setActiveTab('paths')}>
            Resolved Paths ({resolved.resolvedNodes.length})
          </button>
          <button className={`tab ${activeTab === 'graph' ? 'tab-active' : ''}`} onClick={() => setActiveTab('graph')}>
            Graph
          </button>
          <button className={`tab ${activeTab === 'annotations' ? 'tab-active' : ''}`} onClick={() => setActiveTab('annotations')}>
            Annotations ({annotations.length})
          </button>
        </div>

        <div className="mt-4">
          {activeTab === 'paths' && (
            <PerspectiveTreeTable
              nodes={resolved.resolvedNodes}
              onMetadataUpdated={() => {
                if (id) perspectiveApi.resolve(id).then(setResolved).catch(() => {});
              }}
            />
          )}

          {activeTab === 'graph' && (
            <div className="text-center py-12 text-base-content/50">
              <p>Graph visualization for this perspective.</p>
              <Link to={`/visualization?perspective=${id}`} className="btn btn-sm btn-primary mt-2">
                Open in Visualization
              </Link>
            </div>
          )}

          {activeTab === 'annotations' && (
            <div>
              {annotations.length === 0 ? (
                <p className="text-base-content/50 py-4">No annotations defined. Edit the perspective to add path-scoped metadata.</p>
              ) : (
                <div className="space-y-3">
                  {annotations.map((node) => (
                    <div key={node.path} className="card bg-base-200 p-4">
                      <div className="font-mono text-sm font-bold">{node.path}</div>
                      {node.traverse === false && <span className="badge badge-warning badge-xs">frontier</span>}
                      {node.exclude && <span className="badge badge-error badge-xs">excluded</span>}
                      <div className="mt-2 space-y-1">
                        {node.metadata?.map((m, i) => (
                          <div key={i} className="flex gap-2 text-sm">
                            <span className="font-semibold">{m.name}:</span>
                            <span>{String(m.value)}</span>
                            {m.severity && <span className="badge badge-xs">{m.severity}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
