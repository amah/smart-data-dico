import { useEffect, useState } from 'react';
import { entityApi } from '../services/api';
import { EntityAttribute, Package, Entity } from '../types';

interface FlatAttribute {
  attribute: EntityAttribute;
  entityName: string;
  packageName: string;
  microservice: string;
  entityVersion: string;
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
                    microservice: entity.microservice,
                    entityVersion: entity.version,
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
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-4">Attributes (Flat View)</h1>
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
                <th>Attribute Name</th>
                <th>Type</th>
                <th>Description</th>
                <th>Required</th>
                <th>Entity Name</th>
                <th>Package Name</th>
                <th>Microservice</th>
                <th>Entity Version</th>
              </tr>
            </thead>
            <tbody>
              {attributes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-500">No attributes found.</td>
                </tr>
              ) : (
                attributes.map(({ attribute, entityName, packageName, microservice, entityVersion }) => (
                  <tr key={attribute.uuid + entityName + packageName}>
                    <td>{attribute.name}</td>
                    <td>{attribute.type}</td>
                    <td className="max-w-xs truncate">{attribute.description}</td>
                    <td>{attribute.required ? 'Yes' : 'No'}</td>
                    <td>{entityName}</td>
                    <td>{packageName}</td>
                    <td>{microservice}</td>
                    <td>{entityVersion}</td>
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