import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { servicesApi } from '../services/api';

interface PackageInfo {
  name: string;
  entityCount: number;
}

const HomePage = () => {
  const [packages, setPackages] = useState<PackageInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await servicesApi.getAllServices();
        const services: string[] = res.data || [];
        const pkgs = await Promise.all(services.map(async (name) => {
          try {
            const entRes = await servicesApi.getServiceEntities(name);
            return { name, entityCount: entRes.data?.length || 0 };
          } catch { return { name, entityCount: 0 }; }
        }));
        setPackages(pkgs);
      } catch {}
      setLoading(false);
    };
    load();
  }, []);

  const totalEntities = packages.reduce((sum, pkg) => sum + pkg.entityCount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Data Dictionary</h1>
          <p className="text-base-content/70 mt-1">
            {packages.length} packages, {totalEntities} entities
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
          {packages.map((pkg) => (
            <div key={pkg.name} className="card bg-base-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="card-body p-5">
                <h3 className="card-title text-lg font-mono">{pkg.name}</h3>
                <div className="text-xs text-base-content/60 mt-1">
                  {pkg.entityCount} entities
                </div>
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
          ))}
        </div>
      )}
    </div>
  );
};

export default HomePage;
