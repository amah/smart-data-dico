import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { servicesApi } from '../services/api';
import { Entity } from '../types';

const EntityList = () => {
  const { service } = useParams<{ service: string }>();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEntities = async () => {
      if (!service) return;
      
      try {
        setLoading(true);
        const response = await servicesApi.getServiceEntities(service);
        setEntities(response.data);
        setError(null);
      } catch (err) {
        console.error(`Error fetching entities for service ${service}:`, err);
        setError('Failed to load entities. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchEntities();
  }, [service]);

  if (!service) {
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
      <div className="flex flex-col justify-center items-center h-64" role="status" aria-live="polite">
        <span className="loading loading-spinner loading-lg" aria-hidden="true"></span>
        <p className="mt-4 text-gray-600">Loading entities...</p>
        <span className="sr-only">Loading entities, please wait</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error shadow-lg">
        <div>
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h3 className="font-bold">Error</h3>
            <div className="text-xs">{error}</div>
          </div>
        </div>
        <div className="flex-none">
          <button onClick={() => window.location.reload()} className="btn btn-sm">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold">{service} Entities</h1>
        <Link to={`/services/${service}/entities/create`} className="btn btn-outline w-full sm:w-auto">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
          New Entity
        </Link>
      </div>

      {entities.length === 0 ? (
        <div className="alert alert-info shadow-lg">
          <div>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <div>
              <h3 className="font-bold">No entities found</h3>
              <div className="text-sm">No entities found for this service. Create a new entity to get started.</div>
            </div>
          </div>
          <div className="flex-none">
            <Link to={`/services/${service}/entities/create`} className="btn btn-sm btn-outline">
              Create Entity
            </Link>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg shadow p-1"> {/* Added p-1 padding to the container */}
          <div className="hidden sm:block">
            <table className="table table-zebra w-full" aria-label={`Entities in ${service}`}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Attributes</th>
                  <th>Relationships</th>
                  <th>Version</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
              {entities.map((entity) => (
                <tr key={entity.id} className="hover">
                  <td>
                    <Link 
                      to={`/services/${service}/entities/${entity.name}`}
                      className="font-medium hover:underline"
                    >
                      {entity.name}
                    </Link>
                  </td>
                  <td className="max-w-xs truncate">{entity.description}</td>
                  <td>{entity.attributes.length}</td>
                  <td>{entity.relationships?.length || 0}</td>
                  <td>{entity.version}</td>
                  <td>
                    <div className="flex gap-2">
                      <Link
                        to={`/services/${service}/entities/${entity.name}`}
                        className="btn btn-sm btn-ghost btn-square"
                        title="View"
                        aria-label={`View ${entity.name} details`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                          <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                        </svg>
                      </Link>
                      <Link
                        to={`/services/${service}/entities/${entity.name}/edit`}
                        className="btn btn-sm btn-ghost btn-square"
                        title="Edit"
                        aria-label={`Edit ${entity.name}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                      </Link>
                      <div className="dropdown dropdown-end">
                        <label tabIndex={0} className="btn btn-sm btn-ghost btn-square" title="More actions">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                          </svg>
                        </label>
                        <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                          <li>
                            <button
                              onClick={() => {
                                // TODO: Implement add to package logic
                                console.log(`Add ${entity.name} to package`);
                              }}
                              aria-label={`Add ${entity.name} to package`}
                            >
                              <span className="font-mono">+P</span> Add to Package
                            </button>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
          
          {/* Mobile view - cards instead of table */}
          <div className="sm:hidden space-y-4 p-4">
            {entities.map((entity) => (
              <div key={entity.id} className="card bg-base-100 shadow-md">
                <div className="card-body p-4">
                  <h2 className="card-title text-lg">
                    <Link
                      to={`/services/${service}/entities/${entity.name}`}
                      className="hover:underline"
                    >
                      {entity.name}
                    </Link>
                  </h2>
                  <p className="text-sm text-gray-600">{entity.description}</p>
                  <div className="grid grid-cols-2 gap-2 my-2">
                    <div className="text-xs">
                      <span className="font-semibold">Attributes:</span> {entity.attributes.length}
                    </div>
                    <div className="text-xs">
                      <span className="font-semibold">Relationships:</span> {entity.relationships?.length || 0}
                    </div>
                    <div className="text-xs">
                      <span className="font-semibold">Version:</span> {entity.version}
                    </div>
                  </div>
                  <div className="card-actions justify-end mt-2">
                    <Link
                      to={`/services/${service}/entities/${entity.name}`}
                      className="btn btn-sm btn-ghost"
                      aria-label={`View ${entity.name} details`}
                    >
                      View
                    </Link>
                    <Link
                      to={`/services/${service}/entities/${entity.name}/edit`}
                      className="btn btn-sm btn-outline"
                      aria-label={`Edit ${entity.name}`}
                    >
                      Edit
                    </Link>
                    <div className="dropdown dropdown-end">
                      <label tabIndex={0} className="btn btn-sm btn-ghost">
                        More
                      </label>
                      <ul tabIndex={0} className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                        <li>
                          <button
                            onClick={() => {
                              // TODO: Implement add to package logic
                              console.log(`Add ${entity.name} to package`);
                            }}
                            aria-label={`Add ${entity.name} to package`}
                          >
                            <span className="font-mono">+P</span> Add to Package
                          </button>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EntityList;