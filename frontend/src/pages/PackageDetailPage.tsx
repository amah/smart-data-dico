import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { packageApi } from '../services/api';
import type { Package } from '../types';
import PackageForm from '../components/PackageForm';

interface PackageDetailPageProps {
  packagePath: string[];
}

export default function PackageDetailPage({ packagePath }: PackageDetailPageProps) {
  const navigate = useNavigate();
  const [pkg, setPkg] = useState<Package | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateSub, setShowCreateSub] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
          <div className="flex items-center justify-between">
            <h2 className="card-title text-lg">Entities</h2>
            <Link to={`${packageUrl}/entities/create`} className="btn btn-sm btn-primary">
              Add Entity
            </Link>
          </div>
          {entityCount === 0 ? (
            <p className="text-base-content/50">No entities in this package.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Attributes</th>
                  </tr>
                </thead>
                <tbody>
                  {pkg.entities!.map((entity) => (
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
                </tbody>
              </table>
            </div>
          )}
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
    </div>
  );
}
