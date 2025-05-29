import { useEffect, useState } from 'react';
import { entityApi } from '../services/api';
import { Package } from '../types';

const PackageFlatTable = () => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPackages = async () => {
      setLoading(true);
      setError(null);
      try {
        const pkgs: Package[] = await entityApi.getAllPackages();
        setPackages(pkgs);
      } catch (err) {
        setError('Failed to load packages. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    fetchPackages();
  }, []);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-4">Packages (Flat View)</h1>
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg shadow p-1">
          <table className="table table-zebra w-full">
            <thead>
              <tr>
                <th>Package Name</th>
                <th>Description</th>
                <th>Microservice</th>
                <th>Entity Count</th>
                <th>Created At</th>
                <th>Updated At</th>
              </tr>
            </thead>
            <tbody>
              {packages.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-gray-500">No packages found.</td>
                </tr>
              ) : (
                packages.map((pkg) => (
                  <tr key={pkg.id}>
                    <td>{pkg.name}</td>
                    <td className="max-w-xs truncate">{pkg.description}</td>
                    <td>{pkg.metadata?.microservice || '-'}</td>
                    <td>{pkg.entities?.length ?? 0}</td>
                    <td>{pkg.createdAt ? new Date(pkg.createdAt).toLocaleString() : '-'}</td>
                    <td>{pkg.updatedAt ? new Date(pkg.updatedAt).toLocaleString() : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PackageFlatTable;