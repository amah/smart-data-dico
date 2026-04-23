import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { entityApi, servicesApi } from '../services/api';
import { Attribute, Package, Entity } from '../types';
import {
  useStereotypeMetadata,
  getMetadataValue,
  setMetadataValue,
} from '../hooks/useStereotypeMetadata';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import AttributeSidePanel from './AttributeSidePanel';
import {
  BatchActionBar,
  Chip,
  ColumnChooser,
  DataTable,
  Icon,
  Input,
  PiiChip,
  Toolbar,
  TypeChip,
} from './ui';
import type { ColumnDef } from './ui';

/**
 * AttributeFlatTable — global flat view across every package/entity.
 *
 * Phase-6 redesign: swaps the raw `<table>` for `DataTable`, retires the
 * EditableCell inline-edit pattern in favour of a side-panel, and adds
 * controlled multi-select so bulk actions (Required, Mark PII) reach
 * attributes regardless of which entity owns them.
 *
 * Writes still land through `servicesApi.updateEntity` — the flat view
 * groups selected rows by entity and fires one PUT per affected entity
 * instead of one per attribute (N+1 → at most N, where N is the entity
 * count, not the attribute count).
 */

interface FlatAttribute {
  attribute: Attribute;
  entityName: string;
  entityUuid: string;
  packageName: string;
}

const rowKeyOf = (f: FlatAttribute) => `${f.attribute.uuid}@${f.entityUuid}`;

const ATTR_COL_KEY = 'attribute-flat-columns-v2';

const AttributeFlatTable = () => {
  const [flatAttrs, setFlatAttrs] = useState<FlatAttribute[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const { allColumns } = useStereotypeMetadata('attribute');
  const [metaVisible, setMetaVisible] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(ATTR_COL_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set<string>();
  });
  const [editing, setEditing] = useState<FlatAttribute | null>(null);
  const [selection, setSelection] = useState<Set<string | number>>(() => new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    localStorage.setItem(ATTR_COL_KEY, JSON.stringify([...metaVisible]));
  }, [metaVisible]);

  const fetchAttributes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pkgs: Package[] = await entityApi.getAllPackages();
      setPackages(pkgs);
      const next: FlatAttribute[] = [];
      for (const pkg of pkgs) {
        for (const entity of pkg.entities ?? []) {
          for (const attr of entity.attributes ?? []) {
            next.push({
              attribute: attr,
              entityName: entity.name,
              entityUuid: entity.uuid,
              packageName: pkg.name,
            });
          }
        }
      }
      setFlatAttrs(next);
    } catch {
      setError('Failed to load attributes. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAttributes();
  }, [fetchAttributes]);

  // Auto-populate visible metadata columns from the data on first load.
  useEffect(() => {
    if (flatAttrs.length > 0 && allColumns.length > 0 && metaVisible.size === 0) {
      const used = new Set<string>();
      for (const { attribute } of flatAttrs) {
        for (const entry of attribute.metadata ?? []) {
          if (allColumns.some(c => c.name === entry.name)) used.add(entry.name);
        }
      }
      if (used.size > 0) setMetaVisible(used);
    }
  }, [flatAttrs, allColumns]);

  // Drop selected keys whose rows no longer exist after a refresh.
  useEffect(() => {
    setSelection(prev => {
      if (prev.size === 0) return prev;
      const alive = new Set(flatAttrs.map(rowKeyOf));
      let changed = false;
      const next = new Set<string | number>();
      for (const k of prev) {
        if (alive.has(String(k))) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [flatAttrs]);

  const activeMetaCols = allColumns.filter(c => metaVisible.has(c.name));

  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return flatAttrs;
    return flatAttrs.filter(f =>
      f.attribute.name.toLowerCase().includes(needle) ||
      (f.attribute.description ?? '').toLowerCase().includes(needle) ||
      f.entityName.toLowerCase().includes(needle) ||
      f.packageName.toLowerCase().includes(needle),
    );
  }, [flatAttrs, searchTerm]);

  // ──────────────── Save paths ────────────────
  //
  // Single-attribute save (used by the side panel). Reads from local
  // `packages` state so we don't need a round-trip GET for every save.
  const saveAttribute = useCallback(async (
    packageName: string,
    entityName: string,
    entityUuid: string,
    attrUuid: string,
    updater: (attr: Attribute) => Attribute,
  ) => {
    const pkg = packages.find(p => p.name === packageName);
    const entity = pkg?.entities?.find(e => e.uuid === entityUuid);
    if (!entity) throw new Error('Entity not found');

    const updatedAttrs = entity.attributes.map(a =>
      a.uuid === attrUuid ? updater(a) : a,
    );
    const updatedEntity: Entity = { ...entity, attributes: updatedAttrs };
    await servicesApi.updateEntity(packageName, entityName, updatedEntity);

    setFlatAttrs(prev => prev.map(f => {
      if (f.attribute.uuid === attrUuid && f.entityUuid === entityUuid) {
        return { ...f, attribute: updater(f.attribute) };
      }
      return f;
    }));
    setPackages(prev => prev.map(p => {
      if (p.name !== packageName) return p;
      return {
        ...p,
        entities: p.entities?.map(e =>
          e.uuid === entityUuid ? updatedEntity : e,
        ),
      };
    }));
  }, [packages]);

  // Bulk save: group selected flat rows by entity, apply the mutator to
  // every targeted attribute, and fire one PUT per affected entity.
  const applyToSelection = useCallback(async (
    mutate: (a: Attribute) => Attribute,
  ) => {
    if (selection.size === 0) return;
    setBulkSaving(true);
    try {
      type Group = {
        packageName: string;
        entityName: string;
        entity: Entity;
        attrIds: Set<string>;
      };
      const byEntity = new Map<string, Group>();
      for (const f of flatAttrs) {
        if (!selection.has(rowKeyOf(f))) continue;
        let g = byEntity.get(f.entityUuid);
        if (!g) {
          const pkg = packages.find(p => p.name === f.packageName);
          const entity = pkg?.entities?.find(e => e.uuid === f.entityUuid);
          if (!entity) continue;
          g = { packageName: f.packageName, entityName: f.entityName, entity, attrIds: new Set() };
          byEntity.set(f.entityUuid, g);
        }
        g.attrIds.add(f.attribute.uuid);
      }

      for (const g of byEntity.values()) {
        const updatedAttrs = g.entity.attributes.map(a =>
          g.attrIds.has(a.uuid) ? mutate(a) : a,
        );
        const updatedEntity: Entity = { ...g.entity, attributes: updatedAttrs };
        await servicesApi.updateEntity(g.packageName, g.entityName, updatedEntity);
      }
      await fetchAttributes();
    } catch (err) {
      console.error('Bulk update failed:', err);
    } finally {
      setBulkSaving(false);
    }
  }, [selection, flatAttrs, packages, fetchAttributes]);

  const handleBulkSetRequired = useCallback((required: boolean) => {
    return applyToSelection(a => ({ ...a, required }));
  }, [applyToSelection]);

  const handleBulkSetPii = useCallback((value: 'direct' | '') => {
    return applyToSelection(a => ({
      ...a,
      metadata: setMetadataValue(a.metadata, 'pii', value),
    }));
  }, [applyToSelection]);

  // ──────────────── Columns ────────────────

  const columns: ColumnDef<FlatAttribute>[] = useMemo(() => {
    const std: ColumnDef<FlatAttribute>[] = [
      {
        key: 'name',
        header: 'Name',
        group: 'standard',
        mono: true,
        sortable: true,
        filterable: true,
        width: 'minmax(140px, 1.2fr)',
        accessor: (f) => f.attribute.name,
      },
      {
        key: 'type',
        header: 'Type',
        group: 'standard',
        sortable: true,
        width: 120,
        accessor: (f) => f.attribute.type,
        render: (f) => <TypeChip type={f.attribute.type} />,
      },
      {
        key: 'required',
        header: 'Required',
        group: 'standard',
        sortable: true,
        width: 90,
        align: 'center',
        accessor: (f) => f.attribute.required,
        render: (f) => f.attribute.required
          ? <Chip tone="accent" soft>yes</Chip>
          : <span style={{ color: 'var(--text-subtle)' }}>—</span>,
      },
      {
        key: 'description',
        header: 'Description',
        group: 'standard',
        filterable: true,
        width: 'minmax(200px, 2fr)',
        accessor: (f) => f.attribute.description ?? '',
        render: (f) => f.attribute.description
          ? <span style={{ color: 'var(--text-muted)' }}>{f.attribute.description}</span>
          : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>no description</span>,
      },
      {
        key: 'entity',
        header: 'Entity',
        group: 'standard',
        sortable: true,
        filterable: true,
        width: 140,
        accessor: (f) => f.entityName,
        render: (f) => <span style={{ color: 'var(--text-muted)' }}>{f.entityName}</span>,
      },
      {
        key: 'package',
        header: 'Package',
        group: 'standard',
        sortable: true,
        filterable: true,
        width: 140,
        accessor: (f) => f.packageName,
        render: (f) => <span style={{ color: 'var(--text-muted)' }}>{f.packageName}</span>,
      },
    ];

    const meta: ColumnDef<FlatAttribute>[] = activeMetaCols.map((col) => ({
      key: `meta:${col.name}`,
      header: col.label,
      group: 'metadata',
      width: col.name === 'pii' ? 110 : 120,
      accessor: (f) => {
        const v = getMetadataValue(f.attribute, col.name);
        return v === undefined ? '' : (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
      },
      render: (f) => renderMetadataCell(f.attribute, col),
    }));

    return [...std, ...meta];
  }, [activeMetaCols]);

  const chooserCols = useMemo(() => columns as unknown as ColumnDef<unknown>[], [columns]);
  const allVisibleKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of columns) {
      if ((c.group ?? 'standard') === 'standard') set.add(c.key);
    }
    for (const name of metaVisible) set.add(`meta:${name}`);
    return set;
  }, [columns, metaVisible]);

  const handleVisibleChange = useCallback((next: Set<string>) => {
    const nextMeta = new Set<string>();
    next.forEach((key) => {
      if (key.startsWith('meta:')) nextMeta.add(key.slice(5));
    });
    setMetaVisible(nextMeta);
  }, []);

  // ──────────────── Render ────────────────

  return (
    <div className="flex flex-col min-h-0" style={{ flex: 1 }}>
      <Toolbar attached>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--fs-lg)',
            fontWeight: 600,
            color: 'var(--text)',
          }}
        >
          Attributes
        </h1>
        <span
          className="mono"
          style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}
        >
          {filtered.length} of {flatAttrs.length} · flat view
        </span>
        <Toolbar.Spacer />
        <Input
          icon="search"
          size="sm"
          placeholder="Search attributes…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.currentTarget.value)}
          width={240}
        />
        {allColumns.length > 0 && (
          <ColumnChooser
            columns={chooserCols}
            visible={allVisibleKeys}
            onChange={handleVisibleChange}
            label={`Metadata (${activeMetaCols.length})`}
          />
        )}
      </Toolbar>

      {loading ? (
        <div
          className="flex justify-center items-center"
          style={{
            padding: 40,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderTop: 0,
            borderRadius: '0 0 var(--radius-md) var(--radius-md)',
          }}
        >
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : error ? (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
            borderTop: 0,
            borderRadius: '0 0 var(--radius-md) var(--radius-md)',
            fontSize: 'var(--fs-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="warning" size={14} /> {error}
        </div>
      ) : (
        <DataTable<FlatAttribute>
          columns={columns}
          rows={filtered}
          getRowKey={rowKeyOf}
          visibleColumns={allVisibleKeys}
          onVisibleColumnsChange={handleVisibleChange}
          onRowClick={(f) => setEditing(f)}
          selection={selection}
          onSelectionChange={setSelection}
          attached
          emptyMessage="No attributes found."
        />
      )}

      <BatchActionBar
        count={selection.size}
        onClear={() => setSelection(new Set())}
        label={selection.size === 1 ? 'attribute' : 'attributes'}
        actions={[
          {
            label: 'Required: yes',
            icon: 'check',
            disabled: bulkSaving,
            onClick: () => handleBulkSetRequired(true),
          },
          {
            label: 'Required: no',
            icon: 'minus',
            disabled: bulkSaving,
            onClick: () => handleBulkSetRequired(false),
          },
          {
            label: 'Mark PII',
            icon: 'shield',
            disabled: bulkSaving,
            onClick: () => handleBulkSetPii('direct'),
          },
          {
            label: 'Clear PII',
            icon: 'shield',
            disabled: bulkSaving,
            onClick: () => handleBulkSetPii(''),
          },
        ]}
      />

      {editing && (
        <AttributeSidePanel
          attr={editing.attribute}
          serviceName={editing.packageName}
          entityName={editing.entityName}
          metaColumns={allColumns}
          contextLabel={`${editing.packageName} · ${editing.entityName}`}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await saveAttribute(
              editing.packageName,
              editing.entityName,
              editing.entityUuid,
              editing.attribute.uuid,
              (a) => ({ ...a, ...patch }),
            );
          }}
          onMetadataChange={(col, value) =>
            saveAttribute(
              editing.packageName,
              editing.entityName,
              editing.entityUuid,
              editing.attribute.uuid,
              (a) => ({ ...a, metadata: setMetadataValue(a.metadata, col.name, value) }),
            )
          }
        />
      )}
    </div>
  );
};

// ──────────────── Cell helpers ────────────────

function renderMetadataCell(attr: Attribute, col: MetadataColumn): ReactNode {
  if (col.name === 'pii') {
    const raw = getMetadataValue(attr, 'pii');
    if (raw === undefined || raw === null || raw === false || raw === '') {
      return <PiiChip value={null} />;
    }
    const key = String(raw).toLowerCase();
    const shape = (key === 'indirect' ? 'indirect'
      : key === 'possible' ? 'possible'
      : 'direct') as 'direct' | 'indirect' | 'possible';
    return <PiiChip value={shape} />;
  }
  const v = getMetadataValue(attr, col.name);
  if (v === undefined || v === null || v === '') {
    return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
  }
  if (col.type === 'flag' || col.type === 'boolean') {
    return v
      ? <Chip tone="success" soft>yes</Chip>
      : <Chip tone="neutral">no</Chip>;
  }
  return <span style={{ color: 'var(--text-muted)' }}>{String(v)}</span>;
}

export default AttributeFlatTable;
