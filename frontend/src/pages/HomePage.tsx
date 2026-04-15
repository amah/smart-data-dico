import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { servicesApi, packageApi } from '../services/api';

interface PackageCard {
  name: string;
  description?: string;
  type?: string;
  entityCount: number;
  attributeCount: number;
  relationshipCount: number;
}

const HomePage = () => {
  const [packages, setPackages] = useState<PackageCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await servicesApi.getAllServices();
        const services: string[] = res.data || [];
        const pkgs = await Promise.all(services.map(async (name) => {
          try {
            // Fetches the full package (description, type, entities, relationships)
            const pkg = await packageApi.getPackageByPath(name, []);
            const entities = pkg.entities || [];
            const rels = pkg.relationships || [];
            const attrCount = entities.reduce((s: number, e: any) => s + (e.attributes?.length || 0), 0);
            return {
              name,
              description: pkg.description,
              type: (pkg.type as string) || undefined,
              entityCount: entities.length,
              attributeCount: attrCount,
              relationshipCount: rels.length,
            };
          } catch {
            return { name, entityCount: 0, attributeCount: 0, relationshipCount: 0 };
          }
        }));
        setPackages(pkgs);
      } catch { /* ignore */ }
      setLoading(false);
    };
    load();
  }, []);

  const totalEntities = packages.reduce((sum, pkg) => sum + pkg.entityCount, 0);
  const totalRels = packages.reduce((sum, pkg) => sum + pkg.relationshipCount, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Data Dictionary</h1>
          <p className="text-base-content/70 mt-1">
            {packages.length} packages · {totalEntities} entities · {totalRels} relationships
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {packages.map((pkg) => (
            <div key={pkg.name} className="card bg-base-200 border border-base-300 shadow-md hover:shadow-lg transition-shadow">
              <div className="card-body p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="card-title text-lg font-mono">{pkg.name}</h3>
                  {pkg.type && (
                    <span className="badge badge-sm badge-ghost">{pkg.type}</span>
                  )}
                </div>
                {pkg.description && (
                  <p
                    className="text-sm text-base-content/70 line-clamp-2 leading-snug"
                    title={pkg.description}
                  >
                    {pkg.description}
                  </p>
                )}
                <div className="flex items-center gap-3 text-xs text-base-content/60 mt-1">
                  <span><span className="font-semibold text-base-content/80">{pkg.entityCount}</span> entities</span>
                  <span>·</span>
                  <span><span className="font-semibold text-base-content/80">{pkg.attributeCount}</span> attrs</span>
                  <span>·</span>
                  <span><span className="font-semibold text-base-content/80">{pkg.relationshipCount}</span> rels</span>
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
