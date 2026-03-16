import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { servicesApi } from '../services/api';
import { Entity, EntityAttribute, EntityRelationship } from '../types';
import AttributeList from './AttributeList';
import RelationshipList from './RelationshipList';

const EntityDetail = () => {
  const { service, entity } = useParams<{ service: string; entity: string }>();
  const [entityData, setEntityData] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'attributes' | 'relationships' | 'metadata'>('attributes');
  const [showInfo, setShowInfo] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityDescription, setNewEntityDescription] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // Check if we're in create mode
    console.log('EntityDetail useEffect - service:', service, 'entity:', entity);
    
    // Check if we're on the create route (entity is undefined and we're on the create path)
    const isCreatePath = window.location.pathname.endsWith('/create');
    
    if (entity === 'create' || (isCreatePath && !entity)) {
      console.log('Setting create mode to true');
      setIsCreateMode(true);
      setLoading(false);
      return;
    }

    const fetchEntityData = async () => {
      if (!service || !entity) return;
      
      try {
        setLoading(true);
        const response = await servicesApi.getEntitySchema(service, entity);
        setEntityData(response.data);
        setError(null);
      } catch (err) {
        console.error(`Error fetching entity ${entity} for service ${service}:`, err);
        setError('Failed to load entity details. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchEntityData();
  }, [service, entity]);

  const handleCreateEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!service || !newEntityName) {
      setError('Service and entity name are required');
      return;
    }
    
    try {
      console.log('Creating entity:', newEntityName, 'for service:', service);
      setLoading(true);
      const currentDate = new Date().toISOString();
      const newEntity: Entity = {
        id: `${service}.${newEntityName}`, // Generate ID in format microservice.entityName
        name: newEntityName,
        description: newEntityDescription || `${newEntityName} entity`,
        microservice: service,
        version: '1.0.0',
        attributes: [],
        relationships: [],
        metadata: {},
        createdAt: currentDate,
        updatedAt: currentDate
      };
      
      console.log('Entity data:', newEntity);
      
      try {
        // Always use createEntity since we're creating a new entity
        const response = await servicesApi.createEntity(service, newEntity);
        console.log('Create entity response:', response);
        navigate(`/services/${service}/entities/${newEntityName}`);
      } catch (error: any) {
        console.error('API error creating entity:', error);
        if (error.response) {
          console.error('API error response:', error.response.data);
          setError(`API error: ${error.response.data?.message || error.message || 'Unknown error'}`);
        } else {
          setError(`Error: ${error.message || 'Unknown error'}`);
        }
        setLoading(false);
      }
    } catch (err) {
      console.error('Error in handleCreateEntity:', err);
      setError('Failed to create entity. Please try again.');
      setLoading(false);
    }
  };

  if (!service && !isCreateMode) {
    return (
      <div className="alert alert-error">
        <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Service name is required</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error">
        <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{error}</span>
      </div>
    );
  }

  if (!entityData && !isCreateMode) {
    return (
      <div className="alert alert-warning">
        <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span>Entity not found</span>
      </div>
    );
  }

  if (isCreateMode) {
    console.log('Rendering create mode form');
    return (
      <div className="container mx-auto px-4">
        <h1 className="text-2xl font-bold mb-6">Create New Entity</h1>
        
        {error && (
          <div className="alert alert-error mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}
        
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <form onSubmit={handleCreateEntity}>
              <div className="form-control mb-4">
                <label className="label">
                  <span className="label-text">Entity Name</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  value={newEntityName}
                  onChange={(e) => setNewEntityName(e.target.value)}
                  placeholder="Enter entity name"
                  required
                />
              </div>
              
              <div className="form-control mb-6">
                <label className="label">
                  <span className="label-text">Description</span>
                </label>
                <textarea
                  className="textarea textarea-bordered w-full"
                  value={newEntityDescription}
                  onChange={(e) => setNewEntityDescription(e.target.value)}
                  placeholder="Enter entity description"
                  rows={3}
                />
              </div>
              
              <div className="form-control">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Creating...
                    </>
                  ) : (
                    'Create Entity'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Compact header row */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h1 className="text-lg font-semibold">{entityData?.name}</h1>
        <span className="badge badge-sm badge-outline">{entityData?.microservice}</span>
        <span className="badge badge-sm badge-ghost">v{entityData?.version}</span>
        <span className="text-xs text-base-content/50">{entityData?.attributes?.length || 0} attrs / {entityData?.relationships?.length || 0} rels</span>

        {/* Info toggle */}
        <button
          className="btn btn-ghost btn-xs"
          onClick={() => setShowInfo(!showInfo)}
          title={showInfo ? 'Hide details' : 'Show details'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 transition-transform ${showInfo ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        <div className="ml-auto flex gap-1">
          <Link
            to={`/services/${service}/entities/${entity}/edit`}
            className="btn btn-primary btn-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            Edit
          </Link>
          <Link
            to={`/visualization/${service}/${entity}`}
            className="btn btn-outline btn-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
            </svg>
            Visualize
          </Link>
        </div>
      </div>

      {/* Collapsible info section */}
      {showInfo && (
        <div className="bg-base-100 rounded-lg border border-base-300 p-3 mb-2">
          {entityData?.description && (
            <p className="text-sm text-base-content/70 mb-2">{entityData.description}</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <span className="text-base-content/50">Microservice</span>
              <p className="font-medium">{entityData?.microservice}</p>
            </div>
            <div>
              <span className="text-base-content/50">Version</span>
              <p className="font-medium">{entityData?.version}</p>
            </div>
            <div>
              <span className="text-base-content/50">Attributes</span>
              <p className="font-medium">{entityData?.attributes?.length || 0}</p>
            </div>
            <div>
              <span className="text-base-content/50">Relationships</span>
              <p className="font-medium">{entityData?.relationships?.length || 0}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs + content - takes remaining space */}
      <div className="card bg-base-100 shadow-sm flex-1 min-h-0 flex flex-col">
        <div className="card-body p-3 flex flex-col min-h-0">
          <div className="tabs tabs-bordered tabs-sm">
            <button
              className={`tab ${activeTab === 'attributes' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('attributes')}
            >
              Attributes ({entityData?.attributes?.length || 0})
            </button>
            <button
              className={`tab ${activeTab === 'relationships' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('relationships')}
            >
              Relationships ({entityData?.relationships?.length || 0})
            </button>
            <button
              className={`tab ${activeTab === 'metadata' ? 'tab-active' : ''}`}
              onClick={() => setActiveTab('metadata')}
            >
              Metadata
            </button>
          </div>

          <div className="mt-2 flex-1 overflow-auto min-h-0">
            {activeTab === 'attributes' && entityData && (
              <AttributeList
                attributes={entityData.attributes}
                entityName={entityData.name}
                serviceName={entityData.microservice}
              />
            )}
            
            {activeTab === 'relationships' && entityData && (
              <RelationshipList
                relationships={entityData.relationships || []}
                entityName={entityData.name}
                serviceName={entityData.microservice}
              />
            )}
            
            {activeTab === 'metadata' && entityData && (
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th>Property</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entityData.metadata && Object.entries(entityData.metadata).map(([key, value]) => (
                      <tr key={key}>
                        <td className="font-medium">{key}</td>
                        <td>{JSON.stringify(value)}</td>
                      </tr>
                    ))}
                    {(!entityData.metadata || Object.keys(entityData.metadata).length === 0) && (
                      <tr>
                        <td colSpan={2} className="text-center text-base-content/70">No metadata available</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EntityDetail;