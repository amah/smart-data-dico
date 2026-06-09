import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Breadcrumb } from '../types';

interface BreadcrumbsProps {
  /** When provided, render these items instead of deriving from the URL. */
  items?: Breadcrumb[];
}

const Breadcrumbs = ({ items: itemsProp }: BreadcrumbsProps = {}) => {
  const location = useLocation();

  const breadcrumbs = useMemo(() => {
    if (itemsProp) return itemsProp;
    const pathSegments = location.pathname.split('/').filter(Boolean);
    const items: Breadcrumb[] = [{ label: 'Home', path: '/' }];

    if (pathSegments[0] === 'packages') {
      // Package-based navigation: /packages/root/sub/.../entities/EntityName
      items.push({ label: 'Packages', path: '/packages' });

      const entitiesIndex = pathSegments.indexOf('entities');
      const packageSegments = entitiesIndex > 0
        ? pathSegments.slice(1, entitiesIndex)
        : pathSegments.slice(1);

      // Each package segment is clickable
      packageSegments.forEach((seg, i) => {
        const path = '/packages/' + packageSegments.slice(0, i + 1).join('/');
        items.push({ label: seg, path });
      });

      if (entitiesIndex > 0) {
        const entityBasePath = '/packages/' + packageSegments.join('/') + '/entities';
        items.push({ label: 'Entities', path: entityBasePath });

        if (pathSegments[entitiesIndex + 1]) {
          const entityName = pathSegments[entitiesIndex + 1];
          items.push({
            label: entityName,
            path: entityBasePath + '/' + entityName,
          });

          // Handle edit/create sub-paths
          if (pathSegments[entitiesIndex + 2] === 'edit') {
            items.push({ label: 'Edit', path: entityBasePath + '/' + entityName + '/edit' });
          }
        }
      }
    } else if (pathSegments[0] === 'services') {
      // Legacy service-based navigation
      items.push({ label: 'Services', path: '/services' });
      if (pathSegments[1]) {
        items.push({ label: pathSegments[1], path: `/services/${pathSegments[1]}` });
      }
      if (pathSegments[2] === 'entities') {
        items.push({ label: 'Entities', path: `/services/${pathSegments[1]}/entities` });
        if (pathSegments[3]) {
          items.push({ label: pathSegments[3], path: `/services/${pathSegments[1]}/entities/${pathSegments[3]}` });
        }
      }
    } else if (pathSegments[0] === 'version') {
      items.push({ label: 'Version Control', path: '/version' });
      if (pathSegments[1]) {
        const label = pathSegments[1] === 'history' ? 'History' : pathSegments[1] === 'commit' ? 'Commit Changes' : pathSegments[1];
        items.push({ label, path: `/version/${pathSegments[1]}` });
      }
    } else if (pathSegments[0] === 'diagram') {
      items.push({ label: 'Diagram', path: '/diagram' });
      if (pathSegments[1]) items.push({ label: pathSegments[1], path: `/diagram/${pathSegments[1]}` });
    } else {
      // Default: capitalize each segment
      let currentPath = '';
      pathSegments.forEach((seg) => {
        currentPath += `/${seg}`;
        items.push({ label: seg.charAt(0).toUpperCase() + seg.slice(1), path: currentPath });
      });
    }

    return items;
  }, [location.pathname, itemsProp]);

  if (breadcrumbs.length <= 1) return null;

  return (
    <div className="text-xs breadcrumbs py-0">
      <ul>
        {breadcrumbs.map((breadcrumb, index) => {
          const isLast = index === breadcrumbs.length - 1;
          return (
            <li key={breadcrumb.path}>
              {!isLast ? (
                <Link to={breadcrumb.path}>{breadcrumb.label}</Link>
              ) : (
                <span
                  style={{
                    fontSize: 'var(--fs-md)',
                    fontWeight: 600,
                    color: 'var(--text-default)',
                  }}
                >
                  {breadcrumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default Breadcrumbs;
