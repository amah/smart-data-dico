import { useEffect, useState } from 'react';
import { entityApi, dictionaryApi, servicesApi } from '../services/api';
import { Entity, AttributeType, Package } from '../types';

const EntityFlatTable = () => {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [filters, setFilters] = useState({ name: '', package: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentEntity, setCurrentEntity] = useState<Entity | null>(null);
  const [newEntity, setNewEntity] = useState<Partial<Entity>>({
    name: '',
    description: '',
    microservice: '',
    version: '1.0.0',
    attributes: []
  });

  // For package dropdown
  useEffect(() => {
    const fetchPackages = async () => {
      try {
        const pkgs = await entityApi.getAllPackages();
        setPackages(pkgs);
      } catch (err) {
        // ignore package error for filter
      }
    };
    fetchPackages();
  }, []);

  // Fetch entities with filters
  const fetchEntities = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await entityApi.getFlatEntities({
        name: filters.name,
        package: filters.package,
      });
      setEntities(data);
    } catch (err) {
      setError('Failed to load entities. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEntities();
  };

  // Handle creating a new entity
  const handleCreateEntity = async () => {
    if (!newEntity.name || !newEntity.microservice) {
      setError('Name and microservice are required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Generate a UUID for the new entity
      const uuid = crypto.randomUUID();
      const entityToCreate: Entity = {
        uuid,
        id: uuid, // For backward compatibility
        name: newEntity.name || '',
        description: newEntity.description || '',
        microservice: newEntity.microservice || '',
        version: newEntity.version || '1.0.0',
        attributes: [],
        relationships: []
      };
      
      await servicesApi.createEntity(entityToCreate.microservice, entityToCreate);
      setIsModalOpen(false);
      setNewEntity({
        name: '',
        description: '',
        microservice: '',
        version: '1.0.0',
        attributes: []
      });
      // Refresh the entity list
      fetchEntities();
    } catch (err) {
      console.error('Error creating entity:', err);
      setError('Failed to create entity. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle updating an entity
  const handleUpdateEntity = async () => {
    if (!currentEntity) return;

    setLoading(true);
    setError(null);
    try {
      await servicesApi.updateEntity(currentEntity.microservice, currentEntity.name, currentEntity);
      setIsEditModalOpen(false);
      setCurrentEntity(null);
      // Refresh the entity list
      fetchEntities();
    } catch (err) {
      console.error('Error updating entity:', err);
      setError('Failed to update entity. Please try again.');
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
      await servicesApi.deleteEntity(currentEntity.microservice, currentEntity.name);
      setIsDeleteModalOpen(false);
      setCurrentEntity(null);
      // Refresh the entity list
      fetchEntities();
    } catch (err) {
      console.error('Error deleting entity:', err);
      setError('Failed to delete entity. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle input changes for new entity
  const handleNewEntityChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNewEntity({ ...newEntity, [name]: value });
  };

  // Handle input changes for editing entity
  const handleEditEntityChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (!currentEntity) return;
    
    const { name, value } = e.target;
    setCurrentEntity({ ...currentEntity, [name]: value });
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Entities & Attributes (Flat View)</h1>
        <button
          className="btn btn-primary"
          onClick={() => setIsModalOpen(true)}
        >
          Add Entity
        </button>
      </div>
      <form className="flex flex-wrap gap-4 mb-4" onSubmit={handleFilterSubmit}>
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
        <div className="overflow-x-auto bg-white rounded-lg shadow p-1">
          <table className="table table-zebra w-full">
            <thead>
              <tr>
                <th>Name</th>
                <th>Package</th>
                <th>Description</th>
                <th>Microservice</th>
                <th>Version</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entities.filter(
                (entity) =>
                  // Only include items that have an attributes array (even if empty) and are not typical attribute names
                  Array.isArray(entity.attributes) &&
                  entity.name &&
                  entity.name.toLowerCase() !== 'id' &&
                  entity.name.toLowerCase() !== 'name'
              ).length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-gray-500">No entities found.</td>
                </tr>
              ) : (
                entities
                  .filter(
                    (entity) =>
                      Array.isArray(entity.attributes) &&
                      entity.name &&
                      entity.name.toLowerCase() !== 'id' &&
                      entity.name.toLowerCase() !== 'name'
                  )
                  .map((entity) => (
                    <tr key={entity.uuid}>
                      <td>{entity.name}</td>
                      <td>{entity.metadata?.package || '-'}</td>
                      <td className="max-w-xs truncate">{entity.description}</td>
                      <td>{entity.microservice}</td>
                      <td>{entity.version}</td>
                      <td>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setCurrentEntity(entity);
                              setIsEditModalOpen(true);
                            }}
                            className="btn btn-sm btn-ghost btn-square"
                            title="Edit"
                            aria-label={`Edit ${entity.name}`}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              setCurrentEntity(entity);
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
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
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
                <span className="label-text">Microservice</span>
              </label>
              <input
                type="text"
                name="microservice"
                className="input input-bordered"
                value={newEntity.microservice}
                onChange={handleNewEntityChange}
                required
              />
            </div>
            
            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Version</span>
              </label>
              <input
                type="text"
                name="version"
                className="input input-bordered"
                value={newEntity.version}
                onChange={handleNewEntityChange}
              />
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

      {/* Edit Entity Modal */}
      {isEditModalOpen && currentEntity && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Edit Entity</h2>
            
            {error && <div className="alert alert-error mb-4">{error}</div>}
            
            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Name</span>
              </label>
              <input
                type="text"
                name="name"
                className="input input-bordered"
                value={currentEntity.name}
                onChange={handleEditEntityChange}
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
                value={currentEntity.description}
                onChange={handleEditEntityChange}
              ></textarea>
            </div>
            
            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Microservice</span>
              </label>
              <input
                type="text"
                name="microservice"
                className="input input-bordered"
                value={currentEntity.microservice}
                onChange={handleEditEntityChange}
                required
              />
            </div>
            
            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Version</span>
              </label>
              <input
                type="text"
                name="version"
                className="input input-bordered"
                value={currentEntity.version}
                onChange={handleEditEntityChange}
              />
            </div>
            
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setCurrentEntity(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleUpdateEntity}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Updating...
                  </>
                ) : (
                  'Update'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && currentEntity && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Delete Entity</h2>
            
            <p className="mb-4">
              Are you sure you want to delete the entity <strong>{currentEntity.name}</strong>? This action cannot be undone.
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