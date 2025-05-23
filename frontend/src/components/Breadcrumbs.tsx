import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Breadcrumb } from '../types';

const Breadcrumbs = () => {
  const location = useLocation();
  
  const breadcrumbs = useMemo(() => {
    const pathSegments = location.pathname.split('/').filter(Boolean);
    const breadcrumbItems: Breadcrumb[] = [
      { label: 'Home', path: '/' }
    ];
    
    let currentPath = '';
    
    pathSegments.forEach((segment, index) => {
      currentPath += `/${segment}`;
      
      // Special case for services/[serviceName]/entities/[entityName]
      if (segment === 'services' && index === 0) {
        breadcrumbItems.push({ label: 'Services', path: currentPath });
      } else if (pathSegments[index - 1] === 'services') {
        breadcrumbItems.push({ label: segment, path: currentPath });
      } else if (segment === 'entities' && pathSegments[index - 2] === 'services') {
        breadcrumbItems.push({ label: 'Entities', path: currentPath });
      } else if (pathSegments[index - 1] === 'entities' && pathSegments[index - 3] === 'services') {
        breadcrumbItems.push({ label: segment, path: currentPath });
      }
      // Special case for version control
      else if (segment === 'version') {
        breadcrumbItems.push({ label: 'Version Control', path: currentPath });
      } else if (pathSegments[index - 1] === 'version') {
        const label = segment === 'history' ? 'History' : 
                      segment === 'commit' ? 'Commit Changes' : 
                      segment;
        breadcrumbItems.push({ label, path: currentPath });
      }
      // Default case - capitalize the segment
      else {
        const label = segment.charAt(0).toUpperCase() + segment.slice(1);
        breadcrumbItems.push({ label, path: currentPath });
      }
    });
    
    return breadcrumbItems;
  }, [location.pathname]);

  if (breadcrumbs.length <= 1) {
    return null;
  }

  return (
    <div className="text-sm breadcrumbs">
      <ul>
        {breadcrumbs.map((breadcrumb, index) => (
          <li key={breadcrumb.path}>
            {index < breadcrumbs.length - 1 ? (
              <Link to={breadcrumb.path}>{breadcrumb.label}</Link>
            ) : (
              <span className="font-medium">{breadcrumb.label}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Breadcrumbs;