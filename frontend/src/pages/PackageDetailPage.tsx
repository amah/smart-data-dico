import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { packageApi, servicesApi, stereotypeApi } from '../services/api';
import type { Package, Entity, Stereotype } from '../types';
import PackageForm from '../components/PackageForm';
import CytoscapeGraph from '../components/CytoscapeGraph';
import { useRecordRecentPackage } from '../hooks/useRecentPackages';

interface PackageDetailPageProps {
  packagePath: string[];
}

export default function PackageDetailPage({ packagePath }: PackageDetailPageProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewMode = searchParams.get('view') || 'page';
  const [pkg, setPkg] = useState<Package | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateSub, setShowCreateSub] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showBatchCreate, setShowBatchCreate] = useState(false);
  const [batchText, setBatchText] = useState('');
  const [batchCreating, setBatchCreating] = useState(false);
  const [stereotypes, setStereotypes] = useState<Stereotype[]>([]);
  const [entityFilter, setEntityFilter] = useState('');
  const [entitySort, setEntitySort] = useState<{ key: 'name' | 'description' | 'attributes'; dir: 'asc' | 'desc' }>({
    key: 'name',
    dir: 'asc',
  });

  // Track package visits for the "Recently viewed" strip on Home (#102 P3).
  useRecordRecentPackage(packagePath[0]);

  useEffect(() => {
    stereotypeApi.getAll('entity').then(setStereotypes).catch(() => {});
  }, []);

  const rootPackage = packagePath[0];
  const subPath = packagePath.slice(1);
  const packageUrl = `/packages/${packagePath.join('/')}`;

  useEffect(() => {
    if (packagePath.length === 0) return;

    const fetchPackage = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await packageApi.getPackageByPath(rootPackage, subPath);
        setPkg(data);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Failed to load package');
      } finally {
        setLoading(false);
      }
    };

    fetchPackage();
  }, [rootPackage, subPath.join('/')]);

  const handleCreateSubPackage = async (data: { name: string; description: string; type: string }) => {
    try {
      await packageApi.createSubPackage(rootPackage, [...subPath, data.name], {
        name: data.name,
        description: data.description,
        type: data.type,
      });
      setShowCreateSub(false);
      // Refresh
      const updated = await packageApi.getPackageByPath(rootPackage, subPath);
      setPkg(updated);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create sub-package');
    }
  };

  const handleUpdatePackage = async (data: { name: string; description: string; type: string }) => {
    try {
      await packageApi.updatePackage(rootPackage, subPath, {
        description: data.description,
        type: data.type,
      });
      setShowEdit(false);
      const updated = await packageApi.getPackageByPath(rootPackage, subPath);
      setPkg(updated);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update package');
    }
  };

  const handleDeletePackage = async () => {
    try {
      await packageApi.deletePackage(rootPackage, subPath);
      // Navigate to parent
      if (subPath.length > 0) {
        navigate(`/packages/${[rootPackage, ...subPath.slice(0, -1)].join('/')}`);
      } else {
        navigate('/packages');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete package');
      setShowDeleteConfirm(false);
    }
  };

  const handleBatchCreate = async () => {
    if (!batchText.trim()) return;
    setBatchCreating(true);
    try {
      const lines = batchText.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const parts = line.split('|').map(s => s.trim());
        const name = parts[0];
        if (!name) continue;
        const description = parts[1] || '';
        const stereotype = parts[2] || undefined;

        const entity: Entity = {
          uuid: crypto.randomUUID(),
          name,
          description,
          stereotype: stereotype && stereotypes.some(s => s.id === stereotype) ? stereotype : undefined,
          attributes: [],
        };
        await servicesApi.createEntity(rootPackage, entity);
      }
      setShowBatchCreate(false);
      setBatchText('');
      // Refresh
      const updated = await packageApi.getPackageByPath(rootPackage, subPath);
      setPkg(updated);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create entities');
    } finally {
      setBatchCreating(false);
    }
  };

  if (packagePath.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Packages</h1>
        <p className="text-base-content/60 mt-2">Select a package from the sidebar to view details.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!pkg) return null;

  const entityCount = pkg.entities?.length ?? 0;
  const subPackageCount = pkg.subPackages?.length ?? 0;
  const relationshipCount = pkg.relationships?.length ?? 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{pkg.name}</h1>
          {pkg.description && (
            <p className="text-base-content/70 mt-1">{pkg.description}</p>
          )}
          {pkg.type && (
            <span className="badge badge-outline badge-sm mt-2">{pkg.type}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm btn-ghost" onClick={() => setShowEdit(true)}>
            Edit
          </button>
          <button className="btn btn-sm btn-error btn-ghost" onClick={() => setShowDeleteConfirm(true)}>
            Delete
          </button>
        </div>
      </div>

      {/* View mode toggle */}
      <div className="tabs tabs-boxed w-fit">
        <button
          className={`tab ${viewMode === 'page' ? 'tab-active' : ''}`}
          onClick={() => setSearchParams({ view: 'page' })}
        >
          Page View
        </button>
        <button
          className={`tab ${viewMode === 'graph' ? 'tab-active' : ''}`}
          onClick={() => setSearchParams({ view: 'graph' })}
        >
          Diagram View
        </button>
      </div>

      {viewMode === 'graph' ? (
        <div className="h-[600px] border border-base-300 rounded-lg overflow-hidden">
          <CytoscapeGraph service={rootPackage} />
        </div>
      ) : (
      <>
      {/* Stats */}
      <div className="stats stats-horizontal shadow w-full">
        <div className="stat">
          <div className="stat-title">Entities</div>
          <div className="stat-value text-lg">{entityCount}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Sub-packages</div>
          <div className="stat-value text-lg">{subPackageCount}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Relationships</div>
          <div className="stat-value text-lg">{relationshipCount}</div>
        </div>
      </div>

      {/* Entities */}
      <div className="card bg-base-200">
        <div className="card-body">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="card-title text-lg">Entities</h2>
            <div className="flex gap-2 items-center">
              {entityCount > 0 && (
                <input
                  type="text"
                  placeholder="Filter by name or description..."
                  className="input input-sm input-bordered w-60"
                  value={entityFilter}
                  onChange={(e) => setEntityFilter(e.target.value)}
                />
              )}
              <button className="btn btn-sm btn-outline" onClick={() => setShowBatchCreate(true)}>
                Batch Add
              </button>
              <Link to={`${packageUrl}/entities/create`} className="btn btn-sm btn-primary">
                Add Entity
              </Link>
            </div>
          </div>
          {entityCount === 0 ? (
            <p className="text-base-content/50">No entities in this package.</p>
          ) : (() => {
            const q = entityFilter.trim().toLowerCase();
            const base = q
              ? pkg.entities!.filter(e =>
                  e.name.toLowerCase().includes(q) ||
                  (e.description || '').toLowerCase().includes(q),
                )
              : pkg.entities!;
            const filtered = [...base].sort((a, b) => {
              const dir = entitySort.dir === 'asc' ? 1 : -1;
              if (entitySort.key === 'attributes') {
                return ((a.attributes?.length ?? 0) - (b.attributes?.length ?? 0)) * dir;
              }
              const av = (entitySort.key === 'description' ? (a.description || '') : a.name).toLowerCase();
              const bv = (entitySort.key === 'description' ? (b.description || '') : b.name).toLowerCase();
              return av.localeCompare(bv) * dir;
            });
            const toggleSort = (key: 'name' | 'description' | 'attributes') => setEntitySort(s =>
              s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
            );
            const arrow = (key: string) => entitySort.key === key ? (entitySort.dir === 'asc' ? ' ▲' : ' ▼') : '';
            return (
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th className="cursor-pointer select-none" onClick={() => toggleSort('name')}>Name{arrow('name')}</th>
                      <th className="cursor-pointer select-none" onClick={() => toggleSort('description')}>Description{arrow('description')}</th>
                      <th className="cursor-pointer select-none" onClick={() => toggleSort('attributes')}>Attributes{arrow('attributes')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entity) => (
                      <tr key={entity.uuid} className="hover">
                        <td>
                          <Link to={`${packageUrl}/entities/${entity.name}`} className="link link-primary font-mono">
                            {entity.name}
                          </Link>
                        </td>
                        <td className="text-sm text-base-content/70 max-w-xs truncate">
                          {entity.description || '-'}
                        </td>
                        <td>{entity.attributes?.length ?? 0}</td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center text-base-content/50 py-4">
                          No entities match "{entityFilter}"
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Sub-packages */}
      <div className="card bg-base-200">
        <div className="card-body">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-lg">Sub-packages</h2>
            <button className="btn btn-sm btn-primary" onClick={() => setShowCreateSub(true)}>
              Add Sub-package
            </button>
          </div>
          {subPackageCount === 0 ? (
            <p className="text-base-content/50">No sub-packages.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {pkg.subPackages!.map((sub) => (
                <Link
                  key={sub.id}
                  to={`${packageUrl}/${sub.name}`}
                  className="card bg-base-100 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="card-body p-4">
                    <h3 className="font-bold">{sub.name}</h3>
                    {sub.description && (
                      <p className="text-sm text-base-content/70 line-clamp-2">{sub.description}</p>
                    )}
                    <div className="flex gap-2 text-xs opacity-60 mt-1">
                      <span>{sub.entities?.length ?? 0} entities</span>
                      <span>{sub.subPackages?.length ?? 0} sub-packages</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Metadata */}
      {pkg.metadata && pkg.metadata.length > 0 && (
        <div className="card bg-base-200">
          <div className="card-body">
            <h2 className="card-title text-lg">Metadata</h2>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {pkg.metadata.map((entry, i) => (
                    <tr key={i}>
                      <td className="font-mono">{entry.name}</td>
                      <td>{String(entry.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      </>
      )}

      {/* Create Sub-package Modal */}
      {showCreateSub && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Create Sub-package</h3>
            <div className="mt-4">
              <PackageForm
                onSubmit={handleCreateSubPackage}
                onCancel={() => setShowCreateSub(false)}
              />
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowCreateSub(false)}>close</button>
          </form>
        </dialog>
      )}

      {/* Edit Package Modal */}
      {showEdit && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Edit Package</h3>
            <div className="mt-4">
              <PackageForm
                initialValues={{ name: pkg.name, description: pkg.description, type: pkg.type as string }}
                onSubmit={handleUpdatePackage}
                onCancel={() => setShowEdit(false)}
                isEdit
              />
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowEdit(false)}>close</button>
          </form>
        </dialog>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <dialog className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg">Delete Package</h3>
            <p className="py-4">
              Are you sure you want to delete <strong>{pkg.name}</strong>? This cannot be undone.
            </p>
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className="btn btn-error" onClick={handleDeletePackage}>Delete</button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowDeleteConfirm(false)}>close</button>
          </form>
        </dialog>
      )}

      {/* Batch Entity Creation Modal */}
      {showBatchCreate && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <h3 className="font-bold text-lg">Batch Create Entities</h3>
            <p className="text-sm text-base-content/70 mt-1">
              One entity per line. Format: <code className="text-xs">Name | Description | stereotype-id</code>
            </p>
            <textarea
              className="textarea textarea-bordered w-full h-48 mt-3 font-mono text-sm"
              placeholder={`Customer | Main customer entity | aggregate-root\nProduct | Product catalog item | aggregate-root\nCategory | Product category | reference-data\nOrder | Customer order | aggregate-root\nOrderLine | Line item in an order | value-object\nPayment | Payment transaction | event`}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              disabled={batchCreating}
            />
            {stereotypes.length > 0 && (
              <div className="text-xs text-base-content/50 mt-1">
                Available stereotypes: {stereotypes.map(s => s.id).join(', ')}
              </div>
            )}
            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => { setShowBatchCreate(false); setBatchText(''); }} disabled={batchCreating}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleBatchCreate} disabled={batchCreating || !batchText.trim()}>
                {batchCreating ? (
                  <><span className="loading loading-spinner loading-sm"></span> Creating...</>
                ) : (
                  `Create ${batchText.split('\n').filter(l => l.trim()).length} Entities`
                )}
              </button>
            </div>
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => { setShowBatchCreate(false); setBatchText(''); }}>close</button>
          </form>
        </dialog>
      )}
    </div>
  );
}
