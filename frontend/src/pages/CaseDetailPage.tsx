import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { caseApi } from '../services/api';
import type { ResolvedCase } from '../types';
import CaseTreeTable from '../components/CaseTreeTable';
import Breadcrumbs from '../components/Breadcrumbs';
import { Button, PageHeader } from '../components/ui';

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [resolved, setResolved] = useState<ResolvedCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'paths' | 'graph' | 'annotations'>('paths');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    caseApi.resolve(id)
      .then(setResolved)
      .catch(() => setError('Failed to load case'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    if (!id || !confirm('Delete this case?')) return;
    try {
      await caseApi.delete(id);
      navigate('/cases');
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
      <PageHeader
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: 'Home', path: '/' },
              { label: 'Cases', path: '/cases' },
              { label: resolved.name, path: `/cases/${id}` },
            ]}
          />
        }
        meta={
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
            <b>{rootNodes.length}</b> roots · <b>{resolved.resolvedNodes.length}</b> resolved · <b>{frontierNodes.length}</b> frontier · <b>{annotations.length}</b> annotations
          </span>
        }
        description={resolved.description}
        tabs={
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 2,
              background: 'var(--bg-raised)',
              gap: 2,
            }}
          >
            {([
              { id: 'paths', label: `Paths (${resolved.resolvedNodes.length})` },
              { id: 'graph', label: 'Graph' },
              { id: 'annotations', label: `Annotations (${annotations.length})` },
            ] as const).map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    padding: '2px 10px',
                    fontSize: 'var(--fs-sm)',
                    borderRadius: 4,
                    border: 'none',
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-subtle)',
                    cursor: 'pointer',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        }
        actions={
          <>
            <Link to={`/cases/${id}/edit`}>
              <Button size="sm" variant="ghost" icon="edit">Edit</Button>
            </Link>
            <Button size="sm" variant="danger" icon="close" onClick={handleDelete}>Delete</Button>
          </>
        }
      />

      <div>
          {activeTab === 'paths' && (
            <CaseTreeTable
              nodes={resolved.resolvedNodes}
              onMetadataUpdated={() => {
                if (id) caseApi.resolve(id).then(setResolved).catch(() => {});
              }}
            />
          )}

          {activeTab === 'graph' && (
            <div className="text-center py-12 text-base-content/50">
              <p>Graph visualization for this case.</p>
              <Link to={`/visualization?case=${id}`} className="btn btn-sm btn-primary mt-2">
                Open in Visualization
              </Link>
            </div>
          )}

          {activeTab === 'annotations' && (
            <div>
              {annotations.length === 0 ? (
                <p className="text-base-content/50 py-4">No annotations defined. Edit the case to add path-scoped metadata.</p>
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
  );
}
