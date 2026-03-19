import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { servicesApi, diagramApi } from '../services/api';
import { DiagramLayout } from '../types';

import { entityApi } from '../services/api';
import { Package } from '../types';

interface SidebarProps {
  collapsed?: boolean;
}

const Sidebar = ({ collapsed = false }: SidebarProps) => {
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

  // Accordion state: which sections are expanded
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    services: true,
    views: false,
    diagrams: false,
    versionControl: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

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
                          to={`/services/${pkg.name}/entities/${entity.name}`}
                          className={isActive(`/services/${pkg.name}/entities/${entity.name}`) ? 'active' : ''}
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
  };

  // Collapsed sidebar: show only icons
  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center py-4 gap-2">
        <Link to="/" className="btn btn-ghost btn-sm btn-square" title="Home">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
          </svg>
        </Link>
        <Link to="/services" className="btn btn-ghost btn-sm btn-square" title="Services">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
        </Link>
        <Link to="/visualization" className="btn btn-ghost btn-sm btn-square" title="Visualization">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
          </svg>
        </Link>
        <Link to="/version/history" className="btn btn-ghost btn-sm btn-square" title="History">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
          </svg>
        </Link>
      </div>
    );
  }

  // Section header component with accordion toggle
  const SectionHeader = ({ id, title }: { id: string; title: string }) => (
    <button
      className="menu-title flex items-center justify-between w-full cursor-pointer hover:bg-base-300/30 rounded px-1 transition-colors"
      onClick={() => toggleSection(id)}
      type="button"
    >
      <span>{title}</span>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={`h-3 w-3 transition-transform ${expandedSections[id] ? 'rotate-180' : ''}`}
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    </button>
  );

  return (
    <div className="h-full flex flex-col">
      <nav className="flex-1 overflow-y-auto p-2 pt-3">
        <ul className="menu menu-sm p-0 [--tw-bg-opacity:0.05]">
          <li>
            <Link
              to="/"
              className={location.pathname === '/' ? 'active' : ''}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
              </svg>
              Home
            </Link>
          </li>

          {/* Unified Services section (merged Packages + Microservices) */}
          <li className="mt-2">
            <SectionHeader id="services" title="Services" />
            {expandedSections.services && (
              <>
                {packagesLoading && loading ? (
                  <div className="flex justify-center p-2">
                    <span className="loading loading-spinner loading-sm"></span>
                  </div>
                ) : packagesError && error ? (
                  <div className="text-error p-2 text-xs">{packagesError}</div>
                ) : (
                  <>
                    {/* Package tree (primary navigation) */}
                    {packages.length > 0 && (
                      <div className="ml-1">
                        {renderPackageTree(packages)}
                      </div>
                    )}
                    {/* Services list (only show services not already in packages) */}
                    {packages.length === 0 && (
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
                  </>
                )}
              </>
            )}
          </li>

          {/* Views section (flat views only - not duplicating top navbar links) */}
          <li className="mt-1">
            <SectionHeader id="views" title="Views" />
            {expandedSections.views && (
              <ul>
                <li>
                  <Link
                    to="/entities/flat"
                    className={isActive('/entities/flat') ? 'active' : ''}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <rect x="3" y="5" width="14" height="2" rx="1" />
                      <rect x="3" y="9" width="14" height="2" rx="1" />
                      <rect x="3" y="13" width="14" height="2" rx="1" />
                    </svg>
                    Entity Table
                  </Link>
                </li>
                <li>
                  <Link
                    to="/flat/packages"
                    className={isActive('/flat/packages') ? 'active' : ''}
                  >
                    Package List
                  </Link>
                </li>
                <li>
                  <Link
                    to="/flat/entities"
                    className={isActive('/flat/entities') ? 'active' : ''}
                  >
                    Entity List
                  </Link>
                </li>
                <li>
                  <Link
                    to="/flat/attributes"
                    className={isActive('/flat/attributes') ? 'active' : ''}
                  >
                    Attribute List
                  </Link>
                </li>
                <li>
                  <Link
                    to="/tree/hierarchy"
                    className={isActive('/tree/hierarchy') ? 'active' : ''}
                  >
                    Tree Hierarchy
                  </Link>
                </li>
              </ul>
            )}
          </li>

          {/* Diagrams section (merged Saved Diagrams + Diagrams) */}
          <li className="mt-1">
            <SectionHeader id="diagrams" title="Diagrams" />
            {expandedSections.diagrams && (
              <ul>
                <li>
                  <Link
                    to="/organization-diagram"
                    className={isActive('/organization-diagram') ? 'active' : ''}
                  >
                    Organization Diagram
                  </Link>
                </li>
                {diagramsLoading ? (
                  <li>
                    <div className="flex justify-center p-2">
                      <span className="loading loading-spinner loading-sm"></span>
                    </div>
                  </li>
                ) : diagramsError ? (
                  <li className="text-error p-2 text-xs">{diagramsError}</li>
                ) : diagrams.length === 0 ? (
                  <li className="text-base-content/50 px-3 py-1 text-xs">No saved layouts</li>
                ) : (
                  diagrams.map((diagram) => (
                    <li key={diagram.id}>
                      <Link
                        to={`/diagram/${diagram.service || 'all'}?layout=${diagram.id}`}
                        className={location.pathname.startsWith('/diagram') && location.search.includes(`layout=${diagram.id}`) ? 'active' : ''}
                        title={`${diagram.name}${diagram.service ? ` (${diagram.service})` : ' (All Services)'}`}
                      >
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

          {/* Version Control */}
          <li className="mt-1">
            <SectionHeader id="versionControl" title="Version Control" />
            {expandedSections.versionControl && (
              <ul>
                <li>
                  <Link
                    to="/version/history"
                    className={isActive('/version/history') ? 'active' : ''}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
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
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Commit Changes
                  </Link>
                </li>
              </ul>
            )}
          </li>
        </ul>
      </nav>
    </div>
  );
};

export default Sidebar;
