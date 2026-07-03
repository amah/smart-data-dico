import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { entityApi, servicesApi, configApi } from '../services/api';
import type { HideRule } from '../services/api';
import { Entity, Package } from '../types';
import {
  compileHideRules,
  isEntityHidden,
  HIDDEN_META_KEY,
  type CompiledRule,
} from '../utils/visibility';
import {
  resolveElementStyle,
  compileStyleRules,
  type ElementStyle,
  type StyleRule,
  type CompiledStyleRule,
} from '../utils/elementStyle';
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
  EmptyState,
  Field,
  fieldStyle,
  fieldStyleMono,
  Icon,
  Input,
  MetadataField,
  Modal,
  PiiChip,
  Toolbar,
} from './ui';
import type { ColumnDef } from './ui';

/**
 * EntityFlatTable — global flat view of every entity across every package.
 *
 * Phase-6 rewrite: swaps the raw <table> plus inline-editing for
 * DataTable<EntityFlat> plus a side-panel slide-over, consistent with
 * AttributeList / AttributeFlatTable. Create/Delete modals kept but
 * restyled with design tokens. Column resize, sticky header + sticky
 * first column are wired through DataTable's opt-in props (resizeKey,
 * stickyHeader, stickyFirstColumn).
 */

interface EntityFlat {
  entity: Entity;
  packageName: string;
}

const ENTITY_COL_KEY = 'entity-flat-columns-v2';
const SHOW_HIDDEN_KEY = 'sdd-show-hidden';

const EntityFlatTable = () => {
  const [rows, setRows] = useState<EntityFlat[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [pkgFilter, setPkgFilter] = useState<string>('');

  const [compiledRules, setCompiledRules] = useState<CompiledRule[]>([]);
  const [elementStyles, setElementStyles] = useState<ElementStyle[]>([]);
  const [compiledStyleRules, setCompiledStyleRules] = useState<CompiledStyleRule[]>([]);
  const [showHidden, setShowHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(SHOW_HIDDEN_KEY) === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SHOW_HIDDEN_KEY, String(showHidden)); } catch { /* ignore */ }
  }, [showHidden]);

  const { allColumns } = useStereotypeMetadata('entity');
  const [metaVisible, setMetaVisible] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(ENTITY_COL_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set<string>();
  });
  useEffect(() => {
    localStorage.setItem(ENTITY_COL_KEY, JSON.stringify([...metaVisible]));
  }, [metaVisible]);

  const [editing, setEditing] = useState<EntityFlat | null>(null);
  const [selection, setSelection] = useState<Set<string | number>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EntityFlat | null>(null);

  const fetchEntities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pkgs, rules, styles, styleRules] = await Promise.all([
        entityApi.getAllPackages(),
        configApi.getHideRules().catch((): HideRule[] => []),
        configApi.getElementStyles().catch((): ElementStyle[] => []),
        configApi.getStyleRules().catch((): StyleRule[] => []),
      ]);
      setCompiledRules(compileHideRules(rules));
      setElementStyles(styles);
      setCompiledStyleRules(compileStyleRules(styleRules));
      setPackages(pkgs);
      const next: EntityFlat[] = [];
      for (const pkg of pkgs) {
        for (const entity of pkg.entities ?? []) {
          next.push({ entity, packageName: pkg.name });
        }
      }
      setRows(next);
    } catch {
      setError('Failed to load entities. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEntities(); }, [fetchEntities]);

  // Auto-populate visible metadata columns from the data on first load.
  useEffect(() => {
    if (rows.length > 0 && allColumns.length > 0 && metaVisible.size === 0) {
      const used = new Set<string>();
      for (const { entity } of rows) {
        for (const entry of entity.metadata ?? []) {
          if (allColumns.some(c => c.name === entry.name)) used.add(entry.name);
        }
      }
      if (used.size > 0) setMetaVisible(used);
    }
  }, [rows, allColumns]);

  // Drop stale uuids from the selection when the row list refreshes.
  useEffect(() => {
    setSelection(prev => {
      if (prev.size === 0) return prev;
      const alive = new Set(rows.map(r => r.entity.uuid));
      let changed = false;
      const next = new Set<string | number>();
      for (const k of prev) {
        if (alive.has(String(k))) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const activeMetaCols = allColumns.filter(c => metaVisible.has(c.name));

  // Set of entity uuids that are effectively hidden (explicit flag or rule).
  const hiddenSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (isEntityHidden(r.entity, compiledRules, r.packageName)) s.add(r.entity.uuid);
    }
    return s;
  }, [rows, compiledRules]);

  const searchFiltered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return rows.filter(r => {
      if (pkgFilter && r.packageName !== pkgFilter) return false;
      if (!needle) return true;
      return r.entity.name.toLowerCase().includes(needle)
        || (r.entity.description ?? '').toLowerCase().includes(needle)
        || r.packageName.toLowerCase().includes(needle);
    });
  }, [rows, searchTerm, pkgFilter]);

  const hiddenCount = useMemo(
    () => searchFiltered.reduce((n, r) => n + (hiddenSet.has(r.entity.uuid) ? 1 : 0), 0),
    [searchFiltered, hiddenSet],
  );

  const filtered = useMemo(
    () => showHidden ? searchFiltered : searchFiltered.filter(r => !hiddenSet.has(r.entity.uuid)),
    [searchFiltered, showHidden, hiddenSet],
  );

  // ──────────────── Save paths ────────────────

  const saveEntity = useCallback(async (
    packageName: string,
    originalName: string,
    next: Entity,
  ) => {
    await servicesApi.updateEntity(packageName, originalName, next);
    setRows(prev => prev.map(r => {
      if (r.entity.uuid === next.uuid && r.packageName === packageName) {
        return { ...r, entity: next };
      }
      return r;
    }));
    setPackages(prev => prev.map(p => {
      if (p.name !== packageName) return p;
      return {
        ...p,
        entities: p.entities?.map(e => e.uuid === next.uuid ? next : e),
      };
    }));
  }, []);

  const handleCreateEntity = async (draft: { name: string; description: string; packageName: string }) => {
    await servicesApi.createEntity(draft.packageName, {
      uuid: crypto.randomUUID(),
      name: draft.name,
      description: draft.description || undefined,
      attributes: [],
    });
    setCreateOpen(false);
    fetchEntities();
  };

  const handleDeleteEntity = async (target: EntityFlat) => {
    await servicesApi.deleteEntity(target.packageName, target.entity.name);
    setDeleteTarget(null);
    setEditing(null);
    fetchEntities();
  };

  const handleToggleHidden = useCallback(async (target: EntityFlat) => {
    const currentlyHidden = isEntityHidden(target.entity, compiledRules, target.packageName);
    const nextHidden = !currentlyHidden;
    try {
      await servicesApi.setEntityHidden(target.packageName, target.entity.name, nextHidden);
      // Mirror the backend write locally so the row flips without a full reload.
      setRows(prev => prev.map(r => {
        if (r.entity.uuid === target.entity.uuid && r.packageName === target.packageName) {
          return {
            ...r,
            entity: {
              ...r.entity,
              metadata: setMetadataValue(r.entity.metadata, HIDDEN_META_KEY, String(nextHidden)),
            },
          };
        }
        return r;
      }));
    } catch (err) {
      console.error('Failed to toggle entity visibility:', err);
    }
  }, [compiledRules]);

  const handleBulkDelete = useCallback(async () => {
    const n = selection.size;
    if (n === 0) return;
    const ok = window.confirm(
      `Delete ${n} entit${n === 1 ? 'y' : 'ies'}? This cannot be undone.`,
    );
    if (!ok) return;
    setBulkDeleting(true);
    try {
      const targets = rows.filter(r => selection.has(r.entity.uuid));
      const results = await Promise.allSettled(
        targets.map(t => servicesApi.deleteEntity(t.packageName, t.entity.name)),
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) console.error(`Bulk delete: ${failed}/${n} entities failed`);
      setSelection(new Set());
      fetchEntities();
    } finally {
      setBulkDeleting(false);
    }
  }, [selection, rows, fetchEntities]);

  // ──────────────── Columns ────────────────

  const columns: ColumnDef<EntityFlat>[] = useMemo(() => {
    const std: ColumnDef<EntityFlat>[] = [
      {
        key: 'name',
        header: 'Name',
        group: 'standard',
        mono: true,
        sortable: true,
        filterable: true,
        width: 'minmax(180px, 1.4fr)',
        accessor: (r) => r.entity.name,
        render: (r) => {
          const hidden = hiddenSet.has(r.entity.uuid);
          // The flat list has no FK adjacency, so no role signals are passed;
          // explicit / rule / stereotype styles still resolve.
          const resolved = resolveElementStyle(r.entity, undefined, elementStyles, compiledStyleRules);
          return (
            <span
              className="mono"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: hidden ? 0.45 : 1 }}
            >
              {resolved.styleName && <StyleBadge style={resolved.style} />}
              {r.entity.name}
              {hidden && <Chip tone="neutral" soft>hidden</Chip>}
            </span>
          );
        },
      },
      {
        key: 'package',
        header: 'Package',
        group: 'standard',
        sortable: true,
        filterable: true,
        width: 160,
        accessor: (r) => r.packageName,
        render: (r) => dimIfHidden(
          hiddenSet.has(r.entity.uuid),
          <span style={{ color: 'var(--text-muted)' }}>{r.packageName}</span>,
        ),
      },
      {
        key: 'attributes',
        header: 'Attrs',
        group: 'standard',
        sortable: true,
        width: 72,
        align: 'center',
        accessor: (r) => r.entity.attributes?.length ?? 0,
        render: (r) => {
          const n = r.entity.attributes?.length ?? 0;
          return dimIfHidden(
            hiddenSet.has(r.entity.uuid),
            n > 0
              ? <Chip tone="neutral" soft>{n}</Chip>
              : <span style={{ color: 'var(--text-subtle)' }}>—</span>,
          );
        },
      },
      {
        key: 'description',
        header: 'Description',
        group: 'standard',
        filterable: true,
        width: 'minmax(260px, 2.2fr)',
        accessor: (r) => r.entity.description ?? '',
        render: (r) => dimIfHidden(
          hiddenSet.has(r.entity.uuid),
          r.entity.description
            ? <span style={{ color: 'var(--text-muted)' }}>{r.entity.description}</span>
            : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>no description</span>,
        ),
      },
    ];

    const meta: ColumnDef<EntityFlat>[] = activeMetaCols.map((col) => ({
      key: `meta:${col.name}`,
      header: col.label,
      group: 'metadata',
      width: col.name === 'pii' ? 110 : 120,
      accessor: (r) => {
        const v = getMetadataValue(r.entity, col.name);
        return v === undefined ? '' : (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
      },
      render: (r) => dimIfHidden(hiddenSet.has(r.entity.uuid), renderMetadataCell(r.entity, col)),
    }));

    return [...std, ...meta];
  }, [activeMetaCols, hiddenSet, elementStyles, compiledStyleRules]);

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
          Entities
        </h1>
        <span
          className="mono"
          style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}
        >
          {filtered.length} of {rows.length} · flat view
        </span>
        <Toolbar.Spacer />
        <Input
          icon="search"
          size="sm"
          placeholder="Search entities…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.currentTarget.value)}
          width={220}
        />
        <PackageFilter
          value={pkgFilter}
          packages={packages}
          onChange={setPkgFilter}
        />
        {allColumns.length > 0 && (
          <ColumnChooser
            columns={chooserCols}
            visible={allVisibleKeys}
            onChange={handleVisibleChange}
            label={`Metadata (${activeMetaCols.length})`}
          />
        )}
        <Button
          size="sm"
          variant={showHidden ? 'soft' : 'ghost'}
          icon={showHidden ? 'eye' : 'eyeOff'}
          onClick={() => setShowHidden(v => !v)}
          aria-pressed={showHidden}
          title={showHidden ? 'Hiding filtered model data' : 'Show hidden model data'}
        >
          {hiddenCount > 0 ? `Show hidden (${hiddenCount})` : 'Show hidden'}
        </Button>
        <Button
          size="md"
          variant="primary"
          icon="plus"
          onClick={() => setCreateOpen(true)}
        >
          Add Entity
        </Button>
      </Toolbar>

      {loading ? (
        <EmptyState kind="loading" attached message="Loading entities…" />
      ) : error ? (
        <EmptyState
          kind="error"
          attached
          title="Failed to load entities"
          message={error}
          action={{ label: 'Retry', icon: 'sparkle', onClick: fetchEntities }}
        />
      ) : (
        <DataTable<EntityFlat>
          columns={columns}
          rows={filtered}
          getRowKey={(r) => r.entity.uuid}
          visibleColumns={allVisibleKeys}
          onVisibleColumnsChange={handleVisibleChange}
          onRowClick={(r) => setEditing(r)}
          selection={selection}
          onSelectionChange={setSelection}
          resizeKey="entity-flat"
          stickyHeader
          stickyFirstColumn
          rowActionsWidth={96}
          rowActions={(r) => {
            const hidden = hiddenSet.has(r.entity.uuid);
            return (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={hidden ? 'eye' : 'eyeOff'}
                  iconOnly
                  aria-label={`${hidden ? 'Unhide' : 'Hide'} ${r.entity.name}`}
                  title={hidden ? 'Unhide' : 'Hide'}
                  onClick={() => handleToggleHidden(r)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon="close"
                  iconOnly
                  aria-label={`Delete ${r.entity.name}`}
                  onClick={() => setDeleteTarget(r)}
                />
              </span>
            );
          }}
          attached
          emptyMessage={
            <EmptyState
              inline
              kind="empty"
              title="No entities found"
              message={
                searchTerm || pkgFilter
                  ? 'No entities match these filters.'
                  : 'No entities defined yet. Use "Add Entity" to create one.'
              }
            />
          }
        />
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

      {editing && (
        <EntitySidePanel
          flat={editing}
          metaColumns={allColumns}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            const next: Entity = { ...editing.entity, ...patch };
            await saveEntity(editing.packageName, editing.entity.name, next);
          }}
          onMetadataChange={async (col, value) => {
            const next: Entity = {
              ...editing.entity,
              metadata: setMetadataValue(editing.entity.metadata, col.name, value),
            };
            await saveEntity(editing.packageName, editing.entity.name, next);
          }}
          onDelete={() => setDeleteTarget(editing)}
        />
      )}

      <CreateEntityModal
        open={createOpen}
        packages={packages}
        onCancel={() => setCreateOpen(false)}
        onSubmit={handleCreateEntity}
      />

      <DeleteEntityModal
        target={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDeleteEntity(deleteTarget)}
      />
    </div>
  );
};

// ──────────────── Helpers ────────────────

/** Dim a cell's content when its row is hidden (shown only in "Show hidden" mode). */
function dimIfHidden(hidden: boolean, node: ReactNode): ReactNode {
  return hidden ? <span style={{ opacity: 0.45 }}>{node}</span> : node;
}

/** Subtle marker for an entity that resolves to a named element style — a small
 *  colored dot (from the style's border/fill), or its `badge` text when present. */
function StyleBadge({ style }: { style?: ElementStyle }): ReactNode {
  if (!style) return null;
  const color = style.border || style.fill || 'var(--text-subtle)';
  if (style.badge) {
    return (
      <span
        className="mono"
        title={style.label || style.name}
        style={{
          fontSize: 9,
          fontWeight: 600,
          lineHeight: 1,
          padding: '2px 5px',
          borderRadius: 3,
          color,
          border: `1px solid ${color}`,
        }}
      >
        {style.badge}
      </span>
    );
  }
  return (
    <span
      title={style.label || style.name}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        flex: '0 0 auto',
      }}
    />
  );
}

function renderMetadataCell(entity: Entity, col: MetadataColumn): ReactNode {
  if (col.name === 'pii') {
    const raw = getMetadataValue(entity, 'pii');
    if (raw === undefined || raw === null || raw === false || raw === '') {
      return <PiiChip value={null} />;
    }
    const key = String(raw).toLowerCase();
    const shape = (key === 'indirect' ? 'indirect'
      : key === 'possible' ? 'possible'
      : 'direct') as 'direct' | 'indirect' | 'possible';
    return <PiiChip value={shape} />;
  }
  const v = getMetadataValue(entity, col.name);
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

// ──────────────── Package filter ────────────────

interface PackageFilterProps {
  value: string;
  packages: Package[];
  onChange: (v: string) => void;
}

const PackageFilter = ({ value, packages, onChange }: PackageFilterProps) => (
  <label
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-muted)',
    }}
  >
    <Icon name="filter" size={12} />
    <select
      value={value}
      aria-label="Filter by package"
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 28,
        padding: '0 6px',
        fontSize: 'var(--fs-sm)',
        fontFamily: 'inherit',
        background: 'var(--bg-raised)',
        color: 'var(--text)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      <option value="">all packages</option>
      {packages.map((p) => (
        <option key={p.id ?? p.name} value={p.name}>{p.name}</option>
      ))}
    </select>
  </label>
);

// ──────────────── Side panel ────────────────

interface EntitySidePanelProps {
  flat: EntityFlat;
  metaColumns: MetadataColumn[];
  onClose: () => void;
  onSave: (patch: Partial<Entity>) => Promise<void>;
  onMetadataChange: (col: MetadataColumn, value: string | number | boolean) => Promise<void>;
  onDelete: () => void;
}

const EntitySidePanel = ({
  flat,
  metaColumns,
  onClose,
  onSave,
  onMetadataChange,
  onDelete,
}: EntitySidePanelProps) => {
  const { entity, packageName } = flat;
  const [name, setName] = useState(entity.name);
  const [description, setDescription] = useState(entity.description ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setName(entity.name);
    setDescription(entity.description ?? '');
    setSavedAt(null);
  }, [entity.uuid]);

  const dirty = name !== entity.name || description !== (entity.description ?? '');

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave({ name, description });
      setSavedAt(Date.now());
    } catch (err) {
      console.error('Failed to save entity:', err);
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
        aria-label="Edit entity"
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
            edit entity
          </span>
          <span
            className="mono"
            style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}
          >
            {entity.name}
          </span>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
            {packageName}
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
          <Field label="Description">
            <textarea
              value={description}
              aria-label="Description"
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              style={{ ...fieldStyle, minHeight: 72, padding: '6px 8px', fontFamily: 'inherit' }}
            />
          </Field>
          <Field label="Attributes" inline>
            <span className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              {entity.attributes?.length ?? 0}
            </span>
          </Field>

          {metaColumns.length > 0 && (
            <div>
              <div
                className="uppercase"
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--meta-label)',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  marginTop: 8,
                  marginBottom: 6,
                  paddingBottom: 4,
                  borderBottom: '1px dashed var(--meta-border)',
                }}
              >
                Governance metadata
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {metaColumns.map((col) => (
                  <MetadataField
                    key={col.name}
                    column={col}
                    value={getMetadataValue(entity, col.name)}
                    onChange={(v) => onMetadataChange(col, v)}
                  />
                ))}
              </div>
            </div>
          )}
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
          <div style={{ flex: 1 }} />
          <Button size="sm" variant="danger" icon="close" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </aside>
    </>
  );
};

// ──────────────── Create modal ────────────────

interface CreateEntityModalProps {
  open: boolean;
  packages: Package[];
  onCancel: () => void;
  onSubmit: (draft: { name: string; description: string; packageName: string }) => Promise<void>;
}

const CreateEntityModal = ({ open, packages, onCancel, onSubmit }: CreateEntityModalProps) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [packageName, setPackageName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(''); setDescription(''); setPackageName(''); setLocalError(null);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!name.trim() || !packageName) {
      setLocalError('Name and package are required');
      return;
    }
    setSubmitting(true);
    setLocalError(null);
    try {
      await onSubmit({ name: name.trim(), description: description.trim(), packageName });
    } catch {
      setLocalError('Failed to create entity. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open title="Create New Entity" onClose={onCancel}>
      {localError && (
        <div
          style={{
            padding: '6px 10px',
            fontSize: 'var(--fs-sm)',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 12,
          }}
        >
          {localError}
        </div>
      )}
      <Field label="Name">
        <input
          type="text"
          name="name"
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={fieldStyleMono}
        />
      </Field>
      <Field label="Description">
        <textarea
          name="description"
          aria-label="Description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ ...fieldStyle, minHeight: 60, padding: '6px 8px', fontFamily: 'inherit' }}
        />
      </Field>
      <Field label="Package">
        <select
          name="packageName"
          aria-label="Package"
          value={packageName}
          onChange={(e) => setPackageName(e.target.value)}
          style={fieldStyleMono}
        >
          <option value="">Select a package</option>
          {packages.map((p) => (
            <option key={p.id ?? p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <Button size="md" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          size="md"
          variant="primary"
          icon="check"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </Modal>
  );
};

// ──────────────── Delete modal ────────────────

interface DeleteEntityModalProps {
  target: EntityFlat | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const DeleteEntityModal = ({ target, onCancel, onConfirm }: DeleteEntityModalProps) => {
  return (
    <Modal open={!!target} title="Delete Entity" onClose={onCancel}>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 16 }}>
        Are you sure you want to delete the entity{' '}
        <strong className="mono" style={{ color: 'var(--text)' }}>{target?.entity.name}</strong>?
        This action cannot be undone.
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button size="md" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="md" variant="danger" icon="close" onClick={onConfirm}>Delete</Button>
      </div>
    </Modal>
  );
};

export default EntityFlatTable;
