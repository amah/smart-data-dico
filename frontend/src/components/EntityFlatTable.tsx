import { useEffect, useState, useCallback } from 'react';
import { entityApi, servicesApi } from '../services/api';
import { Entity, Package } from '../types';
import EditableCell from './EditableCell';

const EntityFlatTable = () => {
  const [entities, setEntities] = useState<{ entity: Entity; packageName: string }[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [filters, setFilters] = useState({ name: '', package: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentEntity, setCurrentEntity] = useState<{ entity: Entity; packageName: string } | null>(null);
  const [newEntity, setNewEntity] = useState<{ name: string; description: string; packageName: string }>({
    name: '',
    description: '',
    packageName: '',
  });

  // Fetch entities with filters
  const fetchEntities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pkgs: Package[] = await entityApi.getAllPackages();
      setPackages(pkgs);
      const flatEntities: { entity: Entity; packageName: string }[] = [];
      for (const pkg of pkgs) {
        if (filters.package && pkg.name !== filters.package) continue;
        if (pkg.entities) {
          for (const entity of pkg.entities) {
            if (filters.name && !entity.name.toLowerCase().includes(filters.name.toLowerCase())) continue;
            flatEntities.push({ entity, packageName: pkg.name });
          }
        }
      }
      setEntities(flatEntities);
    } catch {
      setError('Failed to load entities. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchEntities();
  }, [fetchEntities]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEntities();
  };

  // Handle creating a new entity
  const handleCreateEntity = async () => {
    if (!newEntity.name || !newEntity.packageName) {
      setError('Name and package are required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const uuid = crypto.randomUUID();
      const entityToCreate: Entity = {
        uuid,
        name: newEntity.name,
        description: newEntity.description || undefined,
        attributes: [],
      };

      await servicesApi.createEntity(newEntity.packageName, entityToCreate);
      setIsModalOpen(false);
      setNewEntity({ name: '', description: '', packageName: '' });
      fetchEntities();
    } catch {
      setError('Failed to create entity. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle deleting an entity
  const handleDeleteEntity = async () => {
    if (!currentEntity) return;

    setLoading(true);
    setError(null);
    try {
      await servicesApi.deleteEntity(currentEntity.packageName, currentEntity.entity.name);
      setIsDeleteModalOpen(false);
      setCurrentEntity(null);
      fetchEntities();
    } catch {
      setError('Failed to delete entity. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /** Inline save for entity field */
  const saveEntityField = useCallback(async (
    packageName: string,
    originalName: string,
    entity: Entity,
    field: keyof Entity,
    value: string,
  ) => {
    const updatedEntity = { ...entity, [field]: value };
    await servicesApi.updateEntity(packageName, originalName, updatedEntity);

    // Update local state
    setEntities(prev => prev.map(e => {
      if (e.entity.uuid === entity.uuid && e.packageName === packageName) {
        return { ...e, entity: updatedEntity };
      }
      return e;
    }));
  }, []);

  // Handle input changes for new entity
  const handleNewEntityChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNewEntity({ ...newEntity, [name]: value });
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-lg font-semibold">Entities & Attributes (Flat View)</h1>
        <button
          className="btn btn-primary"
          onClick={() => setIsModalOpen(true)}
        >
          Add Entity
        </button>
      </div>
      <form className="flex flex-wrap gap-3 mb-2" onSubmit={handleFilterSubmit}>
        <input
          type="text"
          name="name"
          placeholder="Name"
          className="input input-bordered"
          value={filters.name}
          onChange={handleFilterChange}
        />
        <select
          name="package"
          className="select select-bordered"
          value={filters.package}
          onChange={handleFilterChange}
        >
          <option value="">All Packages</option>
          {packages.map((pkg) => (
            <option key={pkg.id} value={pkg.name}>{pkg.name}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-outline">Filter</button>
      </form>
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : (
        <div className="overflow-x-auto bg-base-100 rounded-lg shadow p-1 flex-1 min-h-0">
          <table className="table table-zebra w-full">
            <thead>
              <tr>
                <th>Name</th>
                <th>Package</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entities.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-gray-500">No entities found.</td>
                </tr>
              ) : (
                entities.map(({ entity, packageName }) => (
                  <tr key={entity.uuid}>
                    <EditableCell
                      value={entity.name}
                      onSave={async (v) => {
                        await saveEntityField(packageName, entity.name, entity, 'name', v as string);
                      }}
                    />
                    <td>{packageName}</td>
                    <EditableCell
                      value={entity.description || ''}
                      inputType="textarea"
                      className="max-w-xs"
                      onSave={async (v) => {
                        await saveEntityField(packageName, entity.name, entity, 'description', v as string);
                      }}
                    />
                    <td>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setCurrentEntity({ entity, packageName });
                            setIsDeleteModalOpen(true);
                          }}
                          className="btn btn-sm btn-ghost btn-square text-error"
                          title="Delete"
                          aria-label={`Delete ${entity.name}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Entity Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Create New Entity</h2>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Name</span>
              </label>
              <input
                type="text"
                name="name"
                className="input input-bordered"
                value={newEntity.name}
                onChange={handleNewEntityChange}
                required
              />
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                name="description"
                className="textarea textarea-bordered"
                value={newEntity.description}
                onChange={handleNewEntityChange}
              ></textarea>
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Package</span>
              </label>
              <select
                name="packageName"
                className="select select-bordered"
                value={newEntity.packageName}
                onChange={handleNewEntityChange}
                required
              >
                <option value="">Select a package</option>
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.name}>{pkg.name}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsModalOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreateEntity}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Creating...
                  </>
                ) : (
                  'Create'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && currentEntity && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Delete Entity</h2>

            <p className="mb-4">
              Are you sure you want to delete the entity <strong>{currentEntity.entity.name}</strong>? This action cannot be undone.
            </p>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setCurrentEntity(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={handleDeleteEntity}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EntityFlatTable;
