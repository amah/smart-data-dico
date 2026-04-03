import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { entityApi, perspectiveApi } from '../services/api';
import { Package, Perspective } from '../types';

interface SidebarProps {
  collapsed?: boolean;
}

const Sidebar = ({ collapsed = false }: SidebarProps) => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [perspectives, setPerspectives] = useState<Perspective[]>([]);
  const [expandedPackages, setExpandedPackages] = useState<Record<string, boolean>>({});
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [packagesError, setPackagesError] = useState<string | null>(null);
  const location = useLocation();

  // Accordion state: which sections are expanded
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    packages: true,
    perspectives: true,
    views: false,
    versionControl: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

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
    perspectiveApi.getAll().then(setPerspectives).catch(() => {});
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

  // Recursive render for package tree with accumulated path
  const renderPackageTree = (pkgs: Package[], parentPath: string[] = []) => {
    if (!Array.isArray(pkgs)) return <ul />;
    return (
      <ul>
        {pkgs.map((pkg) => {
          const currentPath = [...parentPath, pkg.name];
          const packageUrl = `/packages/${currentPath.join('/')}`;
          return (
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
                <Link to={packageUrl} className={`font-semibold ${isActive(packageUrl) ? 'active' : ''}`}>
                  {pkg.name}
                </Link>
              </div>
              {expandedPackages[pkg.id] && (
                <div className="ml-2">
                  {pkg.entities && pkg.entities.length > 0 && (
                    <ul>
                      {pkg.entities.map((entity) => {
                        const entityUrl = `${packageUrl}/entities/${entity.name}`;
                        return (
                          <li key={entity.uuid}>
                            <Link
                              to={entityUrl}
                              className={isActive(entityUrl) ? 'active' : ''}
                            >
                              {entity.name}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {pkg.subPackages && pkg.subPackages.length > 0 && renderPackageTree(pkg.subPackages, currentPath)}
                </div>
              )}
            </li>
          );
        })}
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

          {/* Packages section */}
          <li className="mt-2">
            <SectionHeader id="packages" title="Packages" />
            {expandedSections.packages && (
              <>
                {packagesLoading ? (
                  <div className="flex justify-center p-2">
                    <span className="loading loading-spinner loading-sm"></span>
                  </div>
                ) : packagesError ? (
                  <div className="text-error p-2 text-xs">{packagesError}</div>
                ) : packages.length > 0 ? (
                  <div className="ml-1">
                    {renderPackageTree(packages)}
                  </div>
                ) : (
                  <div className="text-base-content/50 px-3 py-1 text-xs">No packages</div>
                )}
              </>
            )}
          </li>

          {/* Perspectives section */}
          <li className="mt-1">
            <SectionHeader id="perspectives" title="Perspectives" />
            {expandedSections.perspectives && (
              <ul>
                {perspectives.map((p) => (
                  <li key={p.uuid}>
                    <Link
                      to={`/perspectives/${p.uuid}`}
                      className={isActive(`/perspectives/${p.uuid}`) ? 'active' : ''}
                    >
                      {p.name}
                    </Link>
                  </li>
                ))}
                {perspectives.length === 0 && (
                  <li className="text-base-content/50 px-3 py-1 text-xs">No perspectives</li>
                )}
                <li>
                  <Link to="/perspectives/create" className="text-primary text-xs">
                    + Create
                  </Link>
                </li>
              </ul>
            )}
          </li>

          {/* Diagram */}
          <li className="mt-1">
            <Link
              to="/diagram"
              className={isActive('/diagram') ? 'active' : ''}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
              </svg>
              Diagram
            </Link>
          </li>

          {/* Flat Views */}
          <li className="mt-1">
            <SectionHeader id="views" title="Flat Views" />
            {expandedSections.views && (
              <ul>
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
              </ul>
            )}
          </li>

          {/* Quality */}
          <li className="mt-1">
            <Link
              to="/quality"
              className={isActive('/quality') ? 'active' : ''}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Quality
            </Link>
          </li>

          {/* Settings */}
          <li className="mt-1">
            <Link
              to="/settings"
              className={isActive('/settings') ? 'active' : ''}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
              </svg>
              Settings
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
};

export default Sidebar;
