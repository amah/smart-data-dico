import { useEffect, useState, useCallback } from 'react';
import { entityApi, packageApi } from '../services/api';
import { Package } from '../types';
import { useStereotypeMetadata, getMetadataValue, setMetadataValue } from '../hooks/useStereotypeMetadata';
import { useStickyTablePref } from '../hooks/useStickyTablePref';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import EditableCell from './EditableCell';

const LOCALSTORAGE_KEY = 'package-flat-table-columns';

const PackageFlatTable = () => {
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Metadata-as-columns (#92)
  const { allColumns, columnsByStereotype } = useStereotypeMetadata('package');
  const [pinned, togglePinned] = useStickyTablePref('package-flat');
  const stickyHead = pinned ? 'sticky top-0 z-20 bg-base-100' : '';
  const stickyFirstCol = pinned ? 'sticky left-0 z-10 bg-base-100' : '';
  const stickyCorner = pinned ? 'sticky top-0 left-0 z-30 bg-base-100' : '';
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(LOCALSTORAGE_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set<string>();
  });
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  useEffect(() => {
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify([...visibleColumns]));
  }, [visibleColumns]);

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

  // Auto-detect visible metadata columns from data
  useEffect(() => {
    if (packages.length > 0 && allColumns.length > 0 && visibleColumns.size === 0) {
      const usedKeys = new Set<string>();
      for (const pkg of packages) {
        for (const entry of (pkg as any).metadata || []) {
          if (allColumns.some(c => c.name === entry.name)) usedKeys.add(entry.name);
        }
      }
      if (usedKeys.size > 0) setVisibleColumns(usedKeys);
    }
  }, [packages, allColumns]);

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

  const renderMetaValue = (pkg: Package, col: MetadataColumn) => {
    const val = getMetadataValue(pkg as any, col.name);
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

  const getMetaInputType = (col: MetadataColumn): 'text' | 'toggle' | 'select' => {
    if (col.type === 'flag' || col.type === 'boolean') return 'toggle';
    return 'text';
  };

  /** Inline save for package field */
  const savePackageField = useCallback(async (
    pkg: Package,
    field: 'name' | 'description',
    value: string,
  ) => {
    await packageApi.updatePackage(pkg.name, [], { [field]: value });
    setPackages(prev => prev.map(p => {
      if (p.id === pkg.id) return { ...p, [field]: value };
      return p;
    }));
  }, []);

  /** Save a metadata value on a package */
  const savePackageMetadata = useCallback(async (
    pkg: Package,
    metaName: string,
    value: string | number | boolean,
  ) => {
    const currentMeta = (pkg as any).metadata || [];
    const updatedMetadata = setMetadataValue(currentMeta, metaName, value);
    await packageApi.updatePackage(pkg.name, [], { metadata: updatedMetadata });
    setPackages(prev => prev.map(p => {
      if (p.id === pkg.id) return { ...p, metadata: updatedMetadata } as any;
      return p;
    }));
  }, []);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-lg font-semibold">Packages (Flat View)</h1>
        <div className="flex items-center gap-2">
          <button
            className={`btn btn-sm ${pinned ? 'btn-primary' : 'btn-outline'}`}
            onClick={togglePinned}
            title={pinned ? 'Unfreeze header & first column' : 'Freeze header & first column'}
          >
            {pinned ? 'Frozen' : 'Freeze'}
          </button>

        {/* Metadata column picker (#92) */}
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
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-32">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : (
        <div className={`${pinned ? 'overflow-auto max-h-[70vh]' : 'overflow-x-auto'} bg-base-100 rounded-lg shadow p-1 flex-1 min-h-0`}>
          <table className="table table-zebra w-full">
            <thead>
              <tr>
                <th className={stickyCorner}>Package Name</th>
                <th className={stickyHead}>Description</th>
                <th className={stickyHead}>Microservice</th>
                <th className={stickyHead}>Entity Count</th>
                {activeMetaCols.map(col => (
                  <th key={col.name} title={col.description} className={stickyHead}>
                    <span className="flex items-center gap-1">
                      {col.label}
                      <span className="badge badge-xs badge-ghost font-normal">{col.stereotypeName}</span>
                    </span>
                  </th>
                ))}
                <th className={stickyHead}>Created At</th>
                <th className={stickyHead}>Updated At</th>
              </tr>
            </thead>
            <tbody>
              {packages.length === 0 ? (
                <tr>
                  <td colSpan={6 + activeMetaCols.length} className="text-center text-gray-500">No packages found.</td>
                </tr>
              ) : (
                packages.map((pkg) => (
                  <tr key={pkg.id}>
                    <EditableCell
                      value={pkg.name}
                      className={stickyFirstCol}
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
                    {activeMetaCols.map(col => {
                      const metaInputType = getMetaInputType(col);
                      const metaVal = getMetadataValue(pkg as any, col.name);
                      return (
                        <EditableCell
                          key={col.name}
                          value={metaVal ?? (metaInputType === 'toggle' ? false : '')}
                          inputType={metaInputType}
                          renderDisplay={() => renderMetaValue(pkg, col)}
                          onSave={async (v) => {
                            await savePackageMetadata(pkg, col.name, v as string | number | boolean);
                          }}
                        />
                      );
                    })}
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
