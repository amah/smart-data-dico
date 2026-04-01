import { useEffect, useState } from 'react';
import { entityApi } from '../services/api';
import { Attribute, Package } from '../types';
import { useStereotypeMetadata, getMetadataValue } from '../hooks/useStereotypeMetadata';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';

interface FlatAttribute {
  attribute: Attribute;
  entityName: string;
  packageName: string;
}

const AttributeFlatTable = () => {
  const [attributes, setAttributes] = useState<FlatAttribute[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { allColumns, columnsByStereotype } = useStereotypeMetadata('attribute');
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set());
  const [showColumnPicker, setShowColumnPicker] = useState(false);

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

  // Auto-detect: when data loads, show columns for metadata keys actually present
  useEffect(() => {
    if (attributes.length > 0 && allColumns.length > 0) {
      const usedKeys = new Set<string>();
      for (const { attribute } of attributes) {
        for (const entry of attribute.metadata || []) {
          usedKeys.add(entry.name);
        }
      }
      setVisibleColumns(usedKeys);
    }
  }, [attributes, allColumns]);

  const toggleColumn = (name: string) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleGroup = (stereotypeId: string) => {
    const groupCols = columnsByStereotype[stereotypeId] || [];
    const allVisible = groupCols.every(c => visibleColumns.has(c.name));
    setVisibleColumns(prev => {
      const next = new Set(prev);
      for (const col of groupCols) {
        if (allVisible) next.delete(col.name);
        else next.add(col.name);
      }
      return next;
    });
  };

  const activeMetaCols = allColumns.filter(c => visibleColumns.has(c.name));

  const renderMetaValue = (attr: Attribute, col: MetadataColumn) => {
    const val = getMetadataValue(attr, col.name);
    if (val === undefined || val === '') return <span className="text-base-content/30">-</span>;
    if (col.type === 'flag' || col.type === 'boolean') {
      return val ? (
        <span className="badge badge-xs badge-success">Yes</span>
      ) : (
        <span className="badge badge-xs badge-ghost">No</span>
      );
    }
    return <span className="text-sm">{val.toString()}</span>;
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-semibold">Attributes (Flat View)</h1>

        {/* Column toggle */}
        {allColumns.length > 0 && (
          <div className="relative">
            <button
              className="btn btn-sm btn-outline gap-1"
              onClick={() => setShowColumnPicker(!showColumnPicker)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
              </svg>
              Columns
              {activeMetaCols.length > 0 && (
                <span className="badge badge-xs badge-primary">{activeMetaCols.length}</span>
              )}
            </button>

            {showColumnPicker && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg p-3 min-w-[220px] max-h-[400px] overflow-y-auto">
                {Object.entries(columnsByStereotype).map(([stId, cols]) => {
                  const allOn = cols.every(c => visibleColumns.has(c.name));
                  return (
                    <div key={stId} className="mb-2">
                      <label className="flex items-center gap-2 font-semibold text-sm cursor-pointer mb-1">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-xs checkbox-primary"
                          checked={allOn}
                          onChange={() => toggleGroup(stId)}
                        />
                        {cols[0]?.stereotypeName || stId}
                      </label>
                      {cols.map(col => (
                        <label key={col.name} className="flex items-center gap-2 ml-4 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            className="checkbox checkbox-xs"
                            checked={visibleColumns.has(col.name)}
                            onChange={() => toggleColumn(col.name)}
                          />
                          {col.label}
                        </label>
                      ))}
                    </div>
                  );
                })}
                <div className="border-t border-base-300 mt-2 pt-2 flex gap-2">
                  <button className="btn btn-xs" onClick={() => setVisibleColumns(new Set(allColumns.map(c => c.name)))}>
                    All
                  </button>
                  <button className="btn btn-xs" onClick={() => setVisibleColumns(new Set())}>
                    None
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

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
                {activeMetaCols.map(col => (
                  <th key={col.name} title={col.description}>
                    <span className="flex items-center gap-1">
                      {col.label}
                      <span className="badge badge-xs badge-ghost font-normal">{col.stereotypeName}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attributes.length === 0 ? (
                <tr>
                  <td colSpan={6 + activeMetaCols.length} className="text-center text-gray-500">No attributes found.</td>
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
                    {activeMetaCols.map(col => (
                      <td key={col.name}>{renderMetaValue(attribute, col)}</td>
                    ))}
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
