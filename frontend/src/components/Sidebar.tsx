import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { servicesApi, diagramApi } from '../services/api';
import { DiagramLayout } from '../types';

import { entityApi } from '../services/api';
import { Package, Entity } from '../types';

const Sidebar = () => {
  const [services, setServices] = useState<string[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [expandedPackages, setExpandedPackages] = useState<Record<string, boolean>>({});
  const [diagrams, setDiagrams] = useState<DiagramLayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [diagramsLoading, setDiagramsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [packagesError, setPackagesError] = useState<string | null>(null);
  const [diagramsError, setDiagramsError] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    const fetchServices = async () => {
      try {
        setLoading(true);
        const response = await servicesApi.getAllServices();
        setServices(response.data);
        setError(null);
      } catch (err) {
        console.error('Error fetching services:', err);
        setError('Failed to load services');
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []);

  const fetchDiagrams = async () => {
    try {
      setDiagramsLoading(true);
      const response = await diagramApi.listDiagramLayouts();
      setDiagrams(response.data || response);
      setDiagramsError(null);
    } catch (err) {
      console.error('Error fetching diagrams:', err);
      setDiagramsError('Failed to load diagrams');
    } finally {
      setDiagramsLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagrams();
  }, []);

  // Fetch packages for navigation
  useEffect(() => {
    const fetchPackages = async () => {
      try {
        setPackagesLoading(true);
        const response = await entityApi.getAllPackages();
        setPackages(response);
        setPackagesError(null);
      } catch (err) {
        console.error('Error fetching packages:', err);
        setPackagesError('Failed to load packages');
      } finally {
        setPackagesLoading(false);
      }
    };
    fetchPackages();
  }, []);

  // Listen for diagram updates
  useEffect(() => {
    const handleDiagramUpdate = () => {
      fetchDiagrams();
    };

    window.addEventListener('diagramSaved', handleDiagramUpdate);
    window.addEventListener('diagramDeleted', handleDiagramUpdate);

    return () => {
      window.removeEventListener('diagramSaved', handleDiagramUpdate);
      window.removeEventListener('diagramDeleted', handleDiagramUpdate);
    };
  }, []);

  const isActive = (path: string) => {
    return location.pathname.startsWith(path);
  };

  // Toggle expand/collapse for package tree
  const togglePackage = (pkgId: string) => {
    setExpandedPackages((prev) => ({
      ...prev,
      [pkgId]: !prev[pkgId],
    }));
  };

  // Recursive render for package tree
  const renderPackageTree = (pkgs: Package[]) => {
    if (!Array.isArray(pkgs)) return <ul />;
    return (
      <ul>
        {pkgs.map((pkg) => (
          <li key={pkg.id}>
            <div className="flex items-center">
              {(pkg.subPackages && pkg.subPackages.length > 0) || (pkg.entities && pkg.entities.length > 0) ? (
                <button
                  className="mr-1 btn btn-xs btn-ghost"
                  onClick={() => togglePackage(pkg.id)}
                  aria-label={expandedPackages[pkg.id] ? 'Collapse' : 'Expand'}
                  type="button"
                >
                  {expandedPackages[pkg.id] ? '▼' : '▶'}
                </button>
              ) : null}
              <span className="font-semibold">{pkg.name}</span>
            </div>
            {expandedPackages[pkg.id] && (
              <div className="ml-4">
                {pkg.entities && pkg.entities.length > 0 && (
                  <ul>
                    {pkg.entities.map((entity) => (
                      <li key={entity.uuid}>
                        <Link
                          to={`/entities/${entity.microservice}/${entity.name}`}
                          className={isActive(`/entities/${entity.microservice}/${entity.name}`) ? 'active' : ''}
                        >
                        {entity.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {pkg.subPackages && pkg.subPackages.length > 0 && renderPackageTree(pkg.subPackages)}
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-base-300">
        <h2 className="text-xl font-bold">Data Dictionary</h2>
      </div>
      
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="menu menu-md p-0 [--tw-bg-opacity:0.05]">
          <li>
            <Link
              to="/"
              className={isActive('/') && !isActive('/services') ? 'active' : ''}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              Home
            </Link>
          </li>

          <li className="mt-2">
            <h2 className="menu-title">Packages</h2>
            {packagesLoading ? (
              <div className="flex justify-center p-4">
                <span className="loading loading-spinner loading-md"></span>
              </div>
            ) : packagesError ? (
              <div className="text-error p-2 text-sm">{packagesError}</div>
            ) : (
              <div className="ml-2">
                {packages.length === 0 ? (
                  <div className="text-base-content/60 p-2 text-sm">No packages found</div>
                ) : (
                  renderPackageTree(packages)
                )}
              </div>
            )}
          </li>
          
          <li className="mt-2">
            <h2 className="menu-title">Microservices</h2>
            {loading ? (
              <div className="flex justify-center p-4">
                <span className="loading loading-spinner loading-md"></span>
              </div>
            ) : error ? (
              <div className="text-error p-2 text-sm">{error}</div>
            ) : (
              <ul>
                {services.map((service) => (
                  <li key={service}>
                    <Link
                      to={`/services/${service}`}
                      className={isActive(`/services/${service}`) ? 'active' : ''}
                    >
                      {service}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
          
          <li className="mt-2">
            <h2 className="menu-title">Tools</h2>
            <ul>
              <li>
                <Link
                  to="/search"
                  className={isActive('/search') ? 'active' : ''}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                  </svg>
                  Search
                </Link>
              </li>
              <li>
                <Link
                  to="/visualization"
                  className={isActive('/visualization') ? 'active' : ''}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                  </svg>
                  Visualization
                </Link>
              </li>
<li>
                <Link
                  to="/entities/flat"
                  className={isActive('/entities/flat') ? 'active font-bold' : ''}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1 inline" viewBox="0 0 20 20" fill="currentColor">
                    <rect x="3" y="5" width="14" height="2" rx="1" />
                    <rect x="3" y="9" width="14" height="2" rx="1" />
                    <rect x="3" y="13" width="14" height="2" rx="1" />
                  </svg>
                  Flat Entity Table
                </Link>
              </li>
              <li>
                <Link
                  to="/flat/packages"
                  className={isActive('/flat/packages') ? 'active font-bold' : ''}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1 inline" viewBox="0 0 20 20" fill="currentColor">
                    <rect x="3" y="5" width="14" height="2" rx="1" />
                  </svg>
                  Flat Package List
                </Link>
              </li>
              <li>
                <Link
                  to="/flat/entities"
                  className={isActive('/flat/entities') ? 'active font-bold' : ''}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1 inline" viewBox="0 0 20 20" fill="currentColor">
                    <rect x="3" y="9" width="14" height="2" rx="1" />
                  </svg>
                  Flat Entity List
                </Link>
              </li>
              <li>
                <Link
                  to="/flat/attributes"
                  className={isActive('/flat/attributes') ? 'active font-bold' : ''}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1 inline" viewBox="0 0 20 20" fill="currentColor">
                    <rect x="3" y="13" width="14" height="2" rx="1" />
                  </svg>
                  Flat Attribute List
                </Link>
              </li>
              <li>
                <Link
                  to="/tree/hierarchy"
                  className={isActive('/tree/hierarchy') ? 'active font-bold' : ''}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1 inline" viewBox="0 0 20 20" fill="currentColor">
                    <rect x="3" y="5" width="14" height="2" rx="1" />
                    <rect x="3" y="9" width="8" height="2" rx="1" />
                    <rect x="11" y="13" width="6" height="2" rx="1" />
                  </svg>
                  Tree Table Hierarchy
                </Link>
              </li>
            </ul>
          </li>
          
          <li className="mt-2">
            <h2 className="menu-title">Saved Diagrams</h2>
            {diagramsLoading ? (
              <div className="flex justify-center p-4">
                <span className="loading loading-spinner loading-md"></span>
              </div>
            ) : diagramsError ? (
              <div className="text-error p-2 text-sm">{diagramsError}</div>
            ) : (
              <ul>
                {diagrams.length === 0 ? (
                  <li className="text-base-content/60 p-2 text-sm">No saved diagrams</li>
                ) : (
                  diagrams.map((diagram) => (
                    <li key={diagram.id}>
                      <Link
                        to={`/diagram/${diagram.service || 'all'}?layout=${diagram.id}`}
                        className={location.pathname.startsWith('/diagram') && location.search.includes(`layout=${diagram.id}`) ? 'active' : ''}
                        title={`${diagram.name}${diagram.service ? ` (${diagram.service})` : ' (All Services)'}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 01-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z" clipRule="evenodd" />
                        </svg>
                        <span className="truncate">{diagram.name}</span>
                        {diagram.service && (
                          <span className="badge badge-xs badge-outline ml-1">{diagram.service}</span>
                        )}
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            )}
          </li>

          <li className="mt-2">
            <h2 className="menu-title">Diagrams</h2>
            <ul>
              <li>
                <Link
                  to="/organization-diagram"
                  className={isActive('/organization-diagram') ? 'active' : ''}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <rect x="3" y="3" width="14" height="14" rx="2" />
                    <path d="M7 7h6v6H7z" fill="#4a86e8"/>
                  </svg>
                  Organization Diagram
                </Link>
              </li>
            </ul>
          </li>
          
          <li className="mt-2">
            <h2 className="menu-title">Version Control</h2>
            <ul>
              <li>
                <Link
                  to="/version/history"
                  className={isActive('/version/history') ? 'active' : ''}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                  History
                </Link>
              </li>
              <li>
                <Link
                  to="/version/commit"
                  className={isActive('/version/commit') ? 'active' : ''}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Commit Changes
                </Link>
              </li>
            </ul>
          </li>
        </ul>
      </nav>
      
      <div className="p-4 border-t border-base-300">
        <Link 
          to="/settings" 
          className="btn btn-sm btn-block btn-outline"
        >
          Settings
        </Link>
      </div>
    </div>
  );
};

export default Sidebar;