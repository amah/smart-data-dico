import { useEffect, useState, useCallback, useMemo } from 'react';
import { entityApi, servicesApi } from '../services/api';
import { Entity, Package } from '../types';
import { useStereotypeMetadata, getMetadataValue, setMetadataValue } from '../hooks/useStereotypeMetadata';
import { useStickyTablePref } from '../hooks/useStickyTablePref';
import { useResizableColumns, ResizeHandle, type ColumnDef } from '../hooks/useResizableColumns';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import EditableCell from './EditableCell';
import { BatchActionBar } from './ui';

const LOCALSTORAGE_KEY = 'entity-flat-table-columns';

const EntityFlatTable = () => {
  const [entities, setEntities] = useState<{ entity: Entity; packageName: string }[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [filters, setFilters] = useState({ name: '', package: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [currentEntity, setCurrentEntity] = useState<{ entity: Entity; packageName: string } | null>(null);
  const [newEntity, setNewEntity] = useState<{ name: string; description: string; packageName: string }>({
    name: '',
    description: '',
    packageName: '',
  });

  // Metadata-as-columns (#91)
  const { allColumns, columnsByStereotype } = useStereotypeMetadata('entity');
  const [pinned, togglePinned] = useStickyTablePref('entity-flat');
  const stickyHead = pinned ? 'sticky top-0 z-20 bg-base-100' : '';
  const stickyFirstCol = pinned ? 'sticky left-0 z-10 sdd-sticky-col' : '';
  const stickyCorner = pinned ? 'sticky top-0 left-0 z-30 bg-base-100' : '';
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(LOCALSTORAGE_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set<string>();
  });
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  // Bulk selection: keyed by entity uuid.
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Persist column visibility
  useEffect(() => {
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify([...visibleColumns]));
  }, [visibleColumns]);

  // Fetch entities with filters
  const fetchEntities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pkgs: Package[] = await entityApi.getAllPackages();
      setPackages(pkgs);
      const flatEntities: { entity: Entity; packageName: string }[] = [];
      for (const pkg of pkgs) {
        if (filters.package && pkg.name !== filters.package) continue;
        if (pkg.entities) {
          for (const entity of pkg.entities) {
            if (filters.name && !entity.name.toLowerCase().includes(filters.name.toLowerCase())) continue;
            flatEntities.push({ entity, packageName: pkg.name });
          }
        }
      }
      setEntities(flatEntities);
    } catch {
      setError('Failed to load entities. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchEntities();
  }, [fetchEntities]);

  // Auto-detect visible metadata columns from data (if no localStorage yet)
  useEffect(() => {
    if (entities.length > 0 && allColumns.length > 0 && visibleColumns.size === 0) {
      const usedKeys = new Set<string>();
      for (const { entity } of entities) {
        for (const entry of entity.metadata || []) {
          if (allColumns.some(c => c.name === entry.name)) usedKeys.add(entry.name);
        }
      }
      if (usedKeys.size > 0) setVisibleColumns(usedKeys);
    }
  }, [entities, allColumns]);

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

  // Resizable columns (#103)
  const colDefs: ColumnDef[] = useMemo(() => [
    { key: 'name', defaultWidth: 180 },
    { key: 'package', defaultWidth: 140 },
    { key: 'description', defaultWidth: 400 },
    ...activeMetaCols.map(col => ({ key: col.name, defaultWidth: 120 })),
    { key: 'actions', defaultWidth: 60 },
  ], [activeMetaCols]);
  const { widths, startResize, resetWidths, tableStyle } = useResizableColumns('entity-flat', colDefs);

  const renderMetaValue = (entity: Entity, col: MetadataColumn) => {
    const val = getMetadataValue(entity as any, col.name);
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

  /** Save a metadata value on an entity */
  const saveEntityMetadata = useCallback(async (
    packageName: string,
    entityName: string,
    entity: Entity,
    metaName: string,
    value: string | number | boolean,
  ) => {
    const updatedMetadata = setMetadataValue(entity.metadata, metaName, value);
    const updatedEntity = { ...entity, metadata: updatedMetadata };
    await servicesApi.updateEntity(packageName, entityName, updatedEntity);

    setEntities(prev => prev.map(e => {
      if (e.entity.uuid === entity.uuid && e.packageName === packageName) {
        return { ...e, entity: updatedEntity };
      }
      return e;
    }));
    setPackages(prev => prev.map(p => {
      if (p.name !== packageName) return p;
      return {
        ...p,
        entities: p.entities?.map(e =>
          e.uuid === entity.uuid ? updatedEntity : e,
        ),
      };
    }));
  }, []);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEntities();
  };

  // Handle creating a new entity
  const handleCreateEntity = async () => {
    if (!newEntity.name || !newEntity.packageName) {
      setError('Name and package are required');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const uuid = crypto.randomUUID();
      const entityToCreate: Entity = {
        uuid,
        name: newEntity.name,
        description: newEntity.description || undefined,
        attributes: [],
      };

      await servicesApi.createEntity(newEntity.packageName, entityToCreate);
      setIsModalOpen(false);
      setNewEntity({ name: '', description: '', packageName: '' });
      fetchEntities();
    } catch {
      setError('Failed to create entity. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle deleting an entity
  const handleDeleteEntity = async () => {
    if (!currentEntity) return;

    setLoading(true);
    setError(null);
    try {
      await servicesApi.deleteEntity(currentEntity.packageName, currentEntity.entity.name);
      setIsDeleteModalOpen(false);
      setCurrentEntity(null);
      fetchEntities();
    } catch {
      setError('Failed to delete entity. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /** Inline save for entity field */
  const saveEntityField = useCallback(async (
    packageName: string,
    originalName: string,
    entity: Entity,
    field: keyof Entity,
    value: string,
  ) => {
    const updatedEntity = { ...entity, [field]: value };
    await servicesApi.updateEntity(packageName, originalName, updatedEntity);

    // Update local state
    setEntities(prev => prev.map(e => {
      if (e.entity.uuid === entity.uuid && e.packageName === packageName) {
        return { ...e, entity: updatedEntity };
      }
      return e;
    }));
  }, []);

  // Handle input changes for new entity
  const handleNewEntityChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNewEntity({ ...newEntity, [name]: value });
  };

  // Drop stale uuids from the selection when the entity list refreshes.
  useEffect(() => {
    setSelection(prev => {
      if (prev.size === 0) return prev;
      const alive = new Set(entities.map(e => e.entity.uuid));
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (alive.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [entities]);

  const toggleRowSelection = (uuid: string) => {
    setSelection(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  const toggleAllSelection = () => {
    setSelection(prev => {
      if (prev.size === entities.length) return new Set();
      return new Set(entities.map(e => e.entity.uuid));
    });
  };

  // Bulk delete: fan-out DELETE calls. Promise.allSettled lets partial
  // failures surface without aborting the rest of the batch.
  const handleBulkDelete = useCallback(async () => {
    const n = selection.size;
    if (n === 0) return;
    const ok = window.confirm(
      `Delete ${n} entit${n === 1 ? 'y' : 'ies'}? This cannot be undone.`,
    );
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const targets = entities.filter(e => selection.has(e.entity.uuid));
      const results = await Promise.allSettled(
        targets.map(t => servicesApi.deleteEntity(t.packageName, t.entity.name)),
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        console.error(`Bulk delete: ${failed}/${n} entities failed`);
      }
      setSelection(new Set());
      fetchEntities();
    } finally {
      setBulkDeleting(false);
    }
  }, [selection, entities, fetchEntities]);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0">
      <div className="flex justify-between items-center mb-2">
        <h1 className="text-lg font-semibold">Entities & Attributes (Flat View)</h1>
        <div className="flex items-center gap-2">
          {/* Metadata column picker (#91) */}
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
          <button
            className={`btn btn-sm ${pinned ? 'btn-primary' : 'btn-outline'}`}
            onClick={togglePinned}
            title={pinned ? 'Unfreeze header & first column' : 'Freeze header & first column'}
          >
            {pinned ? 'Frozen' : 'Freeze'}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={resetWidths} title="Reset column widths">
            Reset cols
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setIsModalOpen(true)}
          >
            Add Entity
          </button>
        </div>
      </div>
      <form className="flex flex-wrap gap-2 mb-2 items-center" onSubmit={handleFilterSubmit}>
        <input
          type="text"
          name="name"
          placeholder="Name"
          className="input input-bordered input-sm"
          value={filters.name}
          onChange={handleFilterChange}
        />
        <select
          name="package"
          className="select select-bordered select-sm"
          value={filters.package}
          onChange={handleFilterChange}
        >
          <option value="">All Packages</option>
          {packages.map((pkg) => (
            <option key={pkg.id} value={pkg.name}>{pkg.name}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-outline btn-sm">Filter</button>
      </form>
      {loading ? (
        <div className="flex justify-center items-center h-32">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : (
        <div className={`${pinned ? 'overflow-auto max-h-[70vh]' : 'overflow-x-auto p-1'} bg-base-100 rounded-lg shadow flex-1 min-h-0`}>
          <table className={`table table-xs table-zebra ${pinned ? 'sdd-sticky-table' : ''}`} style={tableStyle}>
            <thead>
              <tr>
                <th className={stickyHead} style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs"
                    aria-label="Select all rows"
                    checked={entities.length > 0 && selection.size === entities.length}
                    ref={(el) => {
                      if (el) el.indeterminate = selection.size > 0 && selection.size < entities.length;
                    }}
                    onChange={toggleAllSelection}
                  />
                </th>
                <th className={`${stickyCorner} relative`} style={{ width: widths.name }}>
                  Name
                  <ResizeHandle onMouseDown={(e) => startResize('name', e)} />
                </th>
                <th className={`${stickyHead} relative`} style={{ width: widths.package }}>
                  Package
                  <ResizeHandle onMouseDown={(e) => startResize('package', e)} />
                </th>
                <th className={`${stickyHead} relative`} style={{ width: widths.description }}>
                  Description
                  <ResizeHandle onMouseDown={(e) => startResize('description', e)} />
                </th>
                {activeMetaCols.map(col => (
                  <th key={col.name} title={col.description} className={`${stickyHead} relative`} style={{ width: widths[col.name] }}>
                    <span className="flex items-center gap-1">
                      {col.label}
                      <span className="badge badge-xs badge-ghost font-normal">{col.stereotypeName}</span>
                    </span>
                    <ResizeHandle onMouseDown={(e) => startResize(col.name, e)} />
                  </th>
                ))}
                <th className={`${stickyHead} relative`} style={{ width: widths.actions }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {entities.length === 0 ? (
                <tr>
                  <td colSpan={5 + activeMetaCols.length} className="text-center text-gray-500">No entities found.</td>
                </tr>
              ) : (
                entities.map(({ entity, packageName }) => (
                  <tr key={entity.uuid} className={selection.has(entity.uuid) ? 'bg-base-200' : ''}>
                    <td style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs"
                        aria-label={`Select ${entity.name}`}
                        checked={selection.has(entity.uuid)}
                        onChange={() => toggleRowSelection(entity.uuid)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <EditableCell
                      value={entity.name}
                      className={stickyFirstCol}
                      onSave={async (v) => {
                        await saveEntityField(packageName, entity.name, entity, 'name', v as string);
                      }}
                    />
                    <td>{packageName}</td>
                    <EditableCell
                      value={entity.description || ''}
                      inputType="textarea"
                      className="w-[48ch] max-w-[48ch] align-top"
                      renderDisplay={(v) => (
                        <span className="line-clamp-2 leading-snug" title={String(v)}>
                          {String(v) || <span className="text-base-content/30">—</span>}
                        </span>
                      )}
                      onSave={async (v) => {
                        await saveEntityField(packageName, entity.name, entity, 'description', v as string);
                      }}
                    />
                    {activeMetaCols.map(col => {
                      const metaInputType = getMetaInputType(col);
                      const metaVal = getMetadataValue(entity as any, col.name);
                      return (
                        <EditableCell
                          key={col.name}
                          value={metaVal ?? (metaInputType === 'toggle' ? false : '')}
                          inputType={metaInputType}
                          renderDisplay={() => renderMetaValue(entity, col)}
                          onSave={async (v) => {
                            await saveEntityMetadata(packageName, entity.name, entity, col.name, v as string | number | boolean);
                          }}
                        />
                      );
                    })}
                    <td>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setCurrentEntity({ entity, packageName });
                            setIsDeleteModalOpen(true);
                          }}
                          className="btn btn-sm btn-ghost btn-square text-error"
                          title="Delete"
                          aria-label={`Delete ${entity.name}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Entity Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Create New Entity</h2>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Name</span>
              </label>
              <input
                type="text"
                name="name"
                className="input input-bordered"
                value={newEntity.name}
                onChange={handleNewEntityChange}
                required
              />
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Description</span>
              </label>
              <textarea
                name="description"
                className="textarea textarea-bordered"
                value={newEntity.description}
                onChange={handleNewEntityChange}
              ></textarea>
            </div>

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Package</span>
              </label>
              <select
                name="packageName"
                className="select select-bordered"
                value={newEntity.packageName}
                onChange={handleNewEntityChange}
                required
              >
                <option value="">Select a package</option>
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.name}>{pkg.name}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsModalOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreateEntity}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Creating...
                  </>
                ) : (
                  'Create'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <BatchActionBar
        count={selection.size}
        onClear={() => setSelection(new Set())}
        label={selection.size === 1 ? 'entity' : 'entities'}
        actions={[
          {
            label: 'Delete',
            icon: 'close',
            tone: 'danger',
            disabled: bulkDeleting,
            onClick: handleBulkDelete,
          },
        ]}
      />

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && currentEntity && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Delete Entity</h2>

            <p className="mb-4">
              Are you sure you want to delete the entity <strong>{currentEntity.entity.name}</strong>? This action cannot be undone.
            </p>

            {error && <div className="alert alert-error mb-4">{error}</div>}

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setCurrentEntity(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-error"
                onClick={handleDeleteEntity}
                disabled={loading}
              >
                {loading ? (
                  <>
                    <span className="loading loading-spinner loading-xs mr-2"></span>
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EntityFlatTable;
