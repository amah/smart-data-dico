import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { entityApi } from '../services/api';
import type { Package } from '../types';

const HomePage = () => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    entityApi.getAllPackages()
      .then(setPackages)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const totalEntities = packages.reduce((sum, pkg) => sum + (pkg.entities?.length || 0), 0);
  const totalRelationships = packages.reduce((sum, pkg) => sum + (pkg.relationships?.length || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Data Dictionary</h1>
          <p className="text-base-content/70 mt-1">
            {packages.length} packages, {totalEntities} entities, {totalRelationships} relationships
          </p>
        </div>
        <Link to="/packages" className="btn btn-primary btn-sm">
          Create Package
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-lg" />
        </div>
      ) : packages.length === 0 ? (
        <div className="text-center py-16 bg-base-200 rounded-lg">
          <h2 className="text-xl font-semibold">No packages yet</h2>
          <p className="text-base-content/60 mt-2">Create your first package to start modeling your data.</p>
          <Link to="/packages" className="btn btn-primary btn-sm mt-4">Get Started</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {packages.map((pkg) => {
            const entityCount = pkg.entities?.length || 0;
            const relCount = pkg.relationships?.length || 0;
            const subCount = pkg.subPackages?.length || 0;

            return (
              <div key={pkg.id} className="card bg-base-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="card-body p-5">
                  <h3 className="card-title text-lg font-mono">{pkg.name}</h3>
                  {pkg.description && (
                    <p className="text-sm text-base-content/70 line-clamp-2">{pkg.description}</p>
                  )}
                  {pkg.type && <span className="badge badge-outline badge-xs">{pkg.type}</span>}

                  {/* Stats */}
                  <div className="flex gap-4 text-xs text-base-content/60 mt-2">
                    <span>{entityCount} entities</span>
                    <span>{relCount} relationships</span>
                    {subCount > 0 && <span>{subCount} sub-packages</span>}
                  </div>

                  {/* Actions */}
                  <div className="card-actions justify-end mt-3">
                    <Link to={`/packages/${pkg.name}`} className="btn btn-primary btn-sm">
                      Browse
                    </Link>
                    <Link to={`/packages/${pkg.name}?view=graph`} className="btn btn-outline btn-sm">
                      Diagram
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default HomePage;
