import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { entityApi, servicesApi } from '../services/api';
import { Attribute, AttributeType, Package, Entity } from '../types';
import {
  useStereotypeMetadata,
  getMetadataValue,
  setMetadataValue,
} from '../hooks/useStereotypeMetadata';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import {
  BatchActionBar,
  Button,
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
        <FlatAttributeSidePanel
          flat={editing}
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

// ──────────────── Side panel ────────────────

interface FlatSidePanelProps {
  flat: FlatAttribute;
  onClose: () => void;
  onSave: (patch: Partial<Attribute>) => Promise<void>;
}

const FlatAttributeSidePanel = ({ flat, onClose, onSave }: FlatSidePanelProps) => {
  const { attribute } = flat;
  const [name, setName] = useState(attribute.name);
  const [type, setType] = useState<AttributeType>(attribute.type);
  const [description, setDescription] = useState(attribute.description ?? '');
  const [required, setRequired] = useState(!!attribute.required);
  const [defaultValue, setDefaultValue] = useState<string>(
    attribute.defaultValue === undefined || attribute.defaultValue === null
      ? ''
      : String(attribute.defaultValue),
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setName(attribute.name);
    setType(attribute.type);
    setDescription(attribute.description ?? '');
    setRequired(!!attribute.required);
    setDefaultValue(
      attribute.defaultValue === undefined || attribute.defaultValue === null
        ? ''
        : String(attribute.defaultValue),
    );
    setSavedAt(null);
  }, [attribute.uuid]);

  const dirty =
    name !== attribute.name ||
    type !== attribute.type ||
    description !== (attribute.description ?? '') ||
    required !== !!attribute.required ||
    defaultValue !== (attribute.defaultValue === undefined || attribute.defaultValue === null
      ? ''
      : String(attribute.defaultValue));

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave({
        name,
        type,
        description,
        required,
        defaultValue: defaultValue === '' ? undefined : defaultValue,
      });
      setSavedAt(Date.now());
    } catch (err) {
      console.error('Failed to save attribute:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.25)',
          zIndex: 40,
        }}
      />
      <aside
        role="dialog"
        aria-label="Edit attribute"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          background: 'var(--bg-raised)',
          borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 50,
          animation: 'sddSlide var(--dur-med) ease-out',
        }}
      >
        <style>{`
          @keyframes sddSlide {
            from { transform: translateX(100%); opacity: 0.7; }
            to   { transform: translateX(0);     opacity: 1;   }
          }
        `}</style>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span
            className="uppercase mono"
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', letterSpacing: '0.04em' }}
          >
            edit attribute
          </span>
          <span
            className="mono"
            style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}
          >
            {attribute.name}
          </span>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
            {flat.packageName} · {flat.entityName}
          </span>
          <div style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" icon="close" onClick={onClose} iconOnly aria-label="close" />
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <Field label="Name">
            <input
              type="text"
              value={name}
              aria-label="Name"
              onChange={(e) => setName(e.target.value)}
              style={fieldStyleMono}
            />
          </Field>
          <Field label="Type">
            <select
              value={type}
              aria-label="Type"
              onChange={(e) => setType(e.target.value as AttributeType)}
              style={fieldStyleMono}
            >
              {Object.values(AttributeType).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              aria-label="Description"
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ ...fieldStyle, minHeight: 60, padding: '6px 8px', fontFamily: 'inherit' }}
            />
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Required" inline>
              <input
                type="checkbox"
                aria-label="Required"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
            </Field>
            <Field label="Default value" grow>
              <input
                type="text"
                value={defaultValue}
                aria-label="Default value"
                onChange={(e) => setDefaultValue(e.target.value)}
                style={fieldStyleMono}
              />
            </Field>
          </div>
        </div>

        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Button
            size="md"
            variant="primary"
            icon="check"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="md" variant="ghost" onClick={onClose}>Cancel</Button>
          {savedAt && !dirty && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--success)' }}>Saved</span>
          )}
        </div>
      </aside>
    </>
  );
};

interface FieldProps {
  label: string;
  inline?: boolean;
  grow?: boolean;
  children: ReactNode;
}

const Field = ({ label, inline, grow, children }: FieldProps) => (
  <label
    style={{
      display: inline ? 'inline-flex' : 'flex',
      flexDirection: inline ? 'row' : 'column',
      alignItems: inline ? 'center' : 'stretch',
      gap: inline ? 6 : 4,
      flex: grow ? 1 : undefined,
    }}
  >
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
      {label}
    </span>
    {children}
  </label>
);

const fieldStyle = {
  height: 28,
  padding: '0 8px',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  background: 'var(--bg-raised)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
} as const;

const fieldStyleMono = {
  ...fieldStyle,
  fontFamily: 'var(--font-mono)',
} as const;

export default AttributeFlatTable;
