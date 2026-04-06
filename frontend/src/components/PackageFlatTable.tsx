import { useEffect, useState, useCallback } from 'react';
import { entityApi, packageApi } from '../services/api';
import { Package } from '../types';
import EditableCell from './EditableCell';

const PackageFlatTable = () => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pkgs: Package[] = await entityApi.getAllPackages();
      setPackages(pkgs);
    } catch {
      setError('Failed to load packages. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  /** Inline save for package field */
  const savePackageField = useCallback(async (
    pkg: Package,
    field: 'name' | 'description',
    value: string,
  ) => {
    await packageApi.updatePackage(pkg.name, [], { [field]: value });

    // Update local state
    setPackages(prev => prev.map(p => {
      if (p.id === pkg.id) {
        return { ...p, [field]: value };
      }
      return p;
    }));
  }, []);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0">
      <h1 className="text-lg font-semibold mb-2">Packages (Flat View)</h1>
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : (
        <div className="overflow-x-auto bg-base-100 rounded-lg shadow p-1 flex-1 min-h-0">
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
                    <EditableCell
                      value={pkg.name}
                      onSave={async (v) => {
                        await savePackageField(pkg, 'name', v as string);
                      }}
                    />
                    <EditableCell
                      value={pkg.description || ''}
                      inputType="textarea"
                      className="max-w-xs"
                      onSave={async (v) => {
                        await savePackageField(pkg, 'description', v as string);
                      }}
                    />
                    <td>{pkg.type || '-'}</td>
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
