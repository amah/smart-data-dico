import { useEffect, useState } from 'react';
import { entityApi } from '../services/api';
import { Attribute, Package } from '../types';

interface FlatAttribute {
  attribute: Attribute;
  entityName: string;
  packageName: string;
}

const AttributeFlatTable = () => {
  const [attributes, setAttributes] = useState<FlatAttribute[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAttributes = async () => {
      setLoading(true);
      setError(null);
      try {
        const pkgs: Package[] = await entityApi.getAllPackages();
        const flatAttrs: FlatAttribute[] = [];
        for (const pkg of pkgs) {
          if (pkg.entities) {
            for (const entity of pkg.entities) {
              if (entity.attributes) {
                for (const attr of entity.attributes) {
                  flatAttrs.push({
                    attribute: attr,
                    entityName: entity.name,
                    packageName: pkg.name,
                  });
                }
              }
            }
          }
        }
        setAttributes(flatAttrs);
      } catch (err) {
        setError('Failed to load attributes. Please try again.');
      } finally {
        setLoading(false);
      }
    };
    fetchAttributes();
  }, []);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0">
      <h1 className="text-lg font-semibold mb-2">Attributes (Flat View)</h1>
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
                <th>Attribute Name</th>
                <th>Type</th>
                <th>Description</th>
                <th>Required</th>
                <th>Entity Name</th>
                <th>Package Name</th>
              </tr>
            </thead>
            <tbody>
              {attributes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-gray-500">No attributes found.</td>
                </tr>
              ) : (
                attributes.map(({ attribute, entityName, packageName }) => (
                  <tr key={attribute.uuid + entityName + packageName}>
                    <td>{attribute.name}</td>
                    <td>{attribute.type}</td>
                    <td className="max-w-xs truncate">{attribute.description}</td>
                    <td>{attribute.required ? 'Yes' : 'No'}</td>
                    <td>{entityName}</td>
                    <td>{packageName}</td>
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

export default AttributeFlatTable;
