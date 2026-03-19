import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import EntityDiagramEditor from '../components/EntityDiagramEditor';
import { servicesApi } from '../services/api';
import { Entity } from '../types';

const EntityDiagramPage: React.FC = () => {
  const { service } = useParams<{ service?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entitiesByService, setEntitiesByService] = useState<{ [serviceName: string]: Entity[] }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [selectedService, setSelectedService] = useState<string>(service || 'all');
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(searchParams.get('layout'));

  // Fetch available services
  useEffect(() => {
    const fetchServices = async () => {
      try {
        const response = await servicesApi.getAllServices();
        const serviceList = response.data || response;
        setServices(serviceList);
      } catch (err) {
        console.error('Error fetching services:', err);
      }
    };
    
    fetchServices();
  }, []);

  // Fetch entities based on selected service
  useEffect(() => {
    const fetchEntities = async () => {
      try {
        setLoading(true);
        setError(null);
  
        if (selectedService === 'all') {
          // Fetch entities from all services and group by service
          const entitiesPromises = services.map(async (serviceName) => {
            try {
              const response = await servicesApi.getServiceEntities(serviceName);
              return { serviceName, entities: response.data || response };
            } catch (err) {
              console.warn(`Could not fetch entities for service: ${serviceName}`, err);
              return { serviceName, entities: [] };
            }
          });
  
          const entitiesResults = await Promise.all(entitiesPromises);
          const byService: { [serviceName: string]: Entity[] } = {};
          let allEntities: Entity[] = [];
          entitiesResults.forEach(({ serviceName, entities }) => {
            byService[serviceName] = entities;
            allEntities = allEntities.concat(entities);
          });
          setEntitiesByService(byService);
          setEntities(allEntities);
        } else {
          // Fetch entities for specific service
          const response = await servicesApi.getServiceEntities(selectedService);
          const allEntities = response.data || response;
          setEntities(allEntities);
          setEntitiesByService({});
        }
      } catch (err) {
        console.error('Error fetching entities:', err);
        setError('Failed to load entities. Please try again later.');
      } finally {
        setLoading(false);
      }
    };
  
    if (services.length > 0) {
      fetchEntities();
    }
  }, [selectedService, services]);

  const handleServiceChange = (newService: string) => {
    setSelectedService(newService);
    // Clear layout parameter when changing service
    if (newService === 'all') {
      navigate('/diagram');
    } else {
      navigate(`/diagram/${newService}`);
    }
    setSelectedLayoutId(null);
  };

  const handleEntityUpdate = async (entity: Entity) => {
    try {
      const svc = selectedService !== 'all' ? selectedService : service || '';
      await servicesApi.updateEntity(svc, entity.name, entity);
      const response = await servicesApi.getServiceEntities(svc);
      const refreshed = response.data || response;
      setEntities(prev => prev.map(e =>
        e.uuid === entity.uuid ? entity : e
      ));
    } catch (err) {
      console.error('Error updating entity:', err);
      setError('Failed to update entity. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-base-200 border-b border-base-300 p-4">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Entity Diagram Editor</h1>
            <p className="text-base-content/70">
              Interactive entity relationship diagram with drag-and-drop editing
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Service selector */}
            <div className="form-control">
              <label className="label">
                <span className="label-text">Service:</span>
              </label>
              <select
                className="select select-bordered select-sm"
                value={selectedService}
                onChange={(e) => handleServiceChange(e.target.value)}
              >
                <option value="all">All Services</option>
                {services.map(serviceName => (
                  <option key={serviceName} value={serviceName}>
                    {serviceName}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Entity count */}
            <div className="stats stats-horizontal shadow">
              <div className="stat">
                <div className="stat-title">Entities</div>
                <div className="stat-value text-lg">{entities.length}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="alert alert-error m-4">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
          <button 
            className="btn btn-sm"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main diagram area */}
      <div className="flex-1 relative overflow-y-auto">
        {selectedService === 'all' ? (
          // Show a diagram for each service
          Object.entries(entitiesByService).filter(([_, ents]) => ents.length > 0).length > 0 ? (
            <div className="space-y-12 p-6">
              {Object.entries(entitiesByService)
                .filter(([_, ents]) => ents.length > 0)
                .map(([serviceName, ents]) => (
                  <div key={serviceName} className="bg-base-100 rounded-xl shadow border border-base-300 p-4">
                    <h2 className="text-xl font-bold mb-2">{serviceName}</h2>
                    <EntityDiagramEditor
                      entities={ents}
                      onEntityUpdate={handleEntityUpdate}
                      readOnly={false}
                      serviceName={serviceName}
                      // No initialLayoutId for multi-service view
                    />
                  </div>
                ))}
            </div>
          ) : (
            <div className="flex flex-col justify-center items-center h-full text-base-content/60">
              <svg className="w-24 h-24 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-xl font-semibold mb-2">No Entities Found</h3>
              <p className="text-center max-w-md">
                No entities are available across all services. Create some entities to get started.
              </p>
            </div>
          )
        ) : (
          entities.length > 0 ? (
            <EntityDiagramEditor
              entities={entities}
              onEntityUpdate={handleEntityUpdate}
              readOnly={false}
              serviceName={selectedService}
              initialLayoutId={selectedLayoutId}
            />
          ) : (
            <div className="flex flex-col justify-center items-center h-full text-base-content/60">
              <svg className="w-24 h-24 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h3 className="text-xl font-semibold mb-2">No Entities Found</h3>
              <p className="text-center max-w-md">
                {`No entities found for the ${selectedService} service. Try selecting a different service or create some entities.`}
              </p>
            </div>
          )
        )}
      </div>

      {/* Instructions */}
      <div className="bg-base-200 border-t border-base-300 p-2">
        <div className="flex justify-center gap-6 text-sm text-base-content/70">
          <span>• Drag entities to reposition them</span>
          <span>• Click + button to show/hide properties</span>
          <span>• Click entity to select and view details</span>
          <span>• Use mouse wheel or toolbar to zoom</span>
          <span>• Drag background to pan the view</span>
        </div>
      </div>
    </div>
  );
};

export default EntityDiagramPage;