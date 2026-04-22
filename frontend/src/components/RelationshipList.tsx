import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Cardinality, Relationship, RelationshipType } from '../types';
import { entityApi, relationshipApi } from '../services/api';
import {
  useStereotypeMetadata,
  getMetadataValue,
  setMetadataValue,
} from '../hooks/useStereotypeMetadata';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import {
  Button,
  Chip,
  ColumnChooser,
  DataTable,
  Icon,
  Input,
  RelationshipKindChip,
  Toolbar,
} from './ui';
import type { ColumnDef } from './ui';
import type { RelationshipKind } from './ui';

/**
 * RelationshipList — Phase 4.2 redesign.
 *
 * Grammar (design_handoff README §4 Relationships):
 *   Standard: From · To · Kind · Cardinality · Description
 *   Metadata: Owner, Cascade, CDC, Navigability, … (stereotype-driven)
 *   Cross-service targets carry a dashed `xsvc` chip next to the name.
 *
 * All writes still flow through relationshipApi.updateRelationship —
 * this is chrome only. Inline cardinality-edits from the old table
 * are merged into the 480px side-panel editor to match the AttributeList
 * (#117 4.1) pattern.
 */

interface RelationshipListProps {
  relationships: Relationship[];
  entityName: string;
  serviceName: string;
  onRelationshipUpdated?: () => void;
}

type EntityLookup = Record<string, { name: string; service: string }>;

const RelationshipList = ({
  relationships,
  entityName,
  serviceName,
  onRelationshipUpdated,
}: RelationshipListProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [entityMap, setEntityMap] = useState<EntityLookup>({});
  const { allColumns } = useStereotypeMetadata('relationship');

  const META_KEY = 'relationship-list-columns-v2';
  const [metaVisible, setMetaVisible] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(META_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set<string>();
  });

  useEffect(() => {
    if (relationships.length === 0 || allColumns.length === 0 || metaVisible.size > 0) return;
    const used = new Set<string>();
    for (const rel of relationships) {
      for (const entry of rel.metadata || []) {
        if (allColumns.some(c => c.name === entry.name)) used.add(entry.name);
      }
    }
    if (used.size > 0) setMetaVisible(used);
  }, [relationships, allColumns]);

  useEffect(() => {
    localStorage.setItem(META_KEY, JSON.stringify([...metaVisible]));
  }, [metaVisible]);

  // Build entity UUID → {name, service} lookup so From/To can show real
  // names and we can detect cross-service references.
  useEffect(() => {
    let cancelled = false;
    entityApi.getAllPackages().then((pkgs) => {
      if (cancelled) return;
      const map: EntityLookup = {};
      for (const pkg of pkgs) {
        for (const e of pkg.entities || []) {
          map[e.uuid] = { name: e.name, service: pkg.name };
        }
      }
      setEntityMap(map);
    }).catch(() => { /* best effort */ });
    return () => { cancelled = true; };
  }, []);

  const [editRel, setEditRel] = useState<Relationship | null>(null);

  const saveRelationship = useCallback(async (
    rel: Relationship,
    updater: (r: Relationship) => Relationship,
  ) => {
    const updated = updater(rel);
    await relationshipApi.updateRelationship(serviceName, rel.uuid, updated);
    onRelationshipUpdated?.();
  }, [serviceName, onRelationshipUpdated]);

  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return relationships;
    return relationships.filter(rel => {
      const fromName = entityMap[rel.source.entity]?.name || rel.source.name || rel.source.entity;
      const toName = entityMap[rel.target.entity]?.name || rel.target.name || rel.target.entity;
      return (
        fromName.toLowerCase().includes(needle) ||
        toName.toLowerCase().includes(needle) ||
        (rel.description || '').toLowerCase().includes(needle)
      );
    });
  }, [relationships, searchTerm, entityMap]);

  const activeMetaColumns = allColumns.filter(c => metaVisible.has(c.name));

  const columns: ColumnDef<Relationship>[] = useMemo(() => {
    const std: ColumnDef<Relationship>[] = [
      {
        key: 'from',
        header: 'From',
        group: 'standard',
        mono: true,
        sortable: true,
        filterable: true,
        width: 'minmax(160px, 1fr)',
        accessor: (r) => entityMap[r.source.entity]?.name || r.source.name || r.source.entity,
        render: (r) => renderEnd(r.source.entity, r.source.name, entityMap, serviceName),
      },
      {
        key: 'to',
        header: 'To',
        group: 'standard',
        mono: true,
        sortable: true,
        filterable: true,
        width: 'minmax(180px, 1fr)',
        accessor: (r) => entityMap[r.target.entity]?.name || r.target.name || r.target.entity,
        render: (r) => renderEnd(r.target.entity, r.target.name, entityMap, serviceName),
      },
      {
        key: 'kind',
        header: 'Kind',
        group: 'standard',
        sortable: true,
        width: 110,
        accessor: (r) => kindOf(r),
        render: (r) => renderKind(r),
      },
      {
        key: 'cardinality',
        header: 'Cardinality',
        group: 'standard',
        width: 110,
        align: 'center',
        accessor: (r) => cardinalityPill(r.source.cardinality, r.target.cardinality),
        render: (r) => (
          <Chip tone="neutral" mono>
            {cardinalityPill(r.source.cardinality, r.target.cardinality)}
          </Chip>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        group: 'standard',
        filterable: true,
        width: 'minmax(220px, 1.6fr)',
        accessor: (r) => r.description || '',
        render: (r) => r.description
          ? <span style={{ color: 'var(--text-muted)' }}>{r.description}</span>
          : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>no description</span>,
      },
    ];

    const meta: ColumnDef<Relationship>[] = activeMetaColumns.map((col) => ({
      key: `meta:${col.name}`,
      header: col.label,
      group: 'metadata',
      width: 120,
      accessor: (r) => {
        const v = getMetadataValue({ metadata: r.metadata } as any, col.name);
        return v === undefined ? '' : (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
      },
      render: (r) => renderRelationshipMeta(r, col),
    }));

    return [...std, ...meta];
  }, [activeMetaColumns, entityMap, serviceName]);

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

  return (
    <div className="flex flex-col gap-2">
      <Toolbar attached>
        <Input
          icon="search"
          size="sm"
          placeholder="Search relationships…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.currentTarget.value)}
          width={280}
        />
        <ColumnChooser
          columns={chooserCols}
          visible={allVisibleKeys}
          onChange={handleVisibleChange}
        />
        <Toolbar.Spacer />
        <Link
          to={`/packages/${serviceName}/entities/${entityName}/relationships/create`}
        >
          <Button size="md" variant="primary" icon="plus">Add relationship</Button>
        </Link>
      </Toolbar>

      <DataTable<Relationship>
        columns={columns}
        rows={filtered}
        getRowKey={(r) => r.uuid}
        visibleColumns={allVisibleKeys}
        onVisibleColumnsChange={handleVisibleChange}
        onRowClick={(r) => setEditRel(r)}
        showFilterRow
        attached
        emptyMessage={
          relationships.length === 0
            ? 'No relationships defined for this entity.'
            : 'No relationships match these filters.'
        }
      />

      {editRel && (
        <RelationshipSidePanel
          rel={editRel}
          entityMap={entityMap}
          currentService={serviceName}
          entityName={entityName}
          metaColumns={allColumns}
          onClose={() => setEditRel(null)}
          onSave={async (patch) => {
            await saveRelationship(editRel, (r) => ({ ...r, ...patch }));
          }}
          onMetadataChange={(col, value) => {
            saveRelationship(editRel, (r) => ({
              ...r,
              metadata: setMetadataValue(r.metadata, col.name, value),
            })).catch((err) => console.error('Failed to update metadata:', err));
          }}
        />
      )}
    </div>
  );
};

// ──────────────── Cell renderers ────────────────

function renderEnd(
  uuid: string,
  navName: string | undefined,
  entityMap: EntityLookup,
  currentService: string,
): ReactNode {
  const info = entityMap[uuid];
  const name = info?.name || navName || uuid;
  const crossService = !!info && info.service !== currentService;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: 500,
        }}
        title={info?.service ? `${name} (${info.service})` : name}
      >
        {name}
      </span>
      {crossService && (
        <Chip tone="info" dashed className="mono" title={`in ${info!.service}`}>
          xsvc
        </Chip>
      )}
      {navName && navName !== name && (
        <span
          className="mono"
          style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}
          title="Navigation role"
        >
          · {navName}
        </span>
      )}
    </span>
  );
}

function kindOf(rel: Relationship): RelationshipKind | 'lineage' {
  if (rel.type === 'lineage') return 'lineage';
  const hasRefs =
    (rel.source.referenceAttributes?.length ?? 0) > 0 ||
    (rel.target.referenceAttributes?.length ?? 0) > 0;
  return hasRefs ? 'reference' : 'embedded';
}

function renderKind(rel: Relationship): ReactNode {
  const k = kindOf(rel);
  if (k === 'lineage') return <Chip tone="info" soft>lineage</Chip>;
  return <RelationshipKindChip kind={k} />;
}

function cardinalityPill(source: Cardinality, target: Cardinality): string {
  const s = source === Cardinality.ONE ? '1' : '*';
  const t = target === Cardinality.ONE ? '1' : '*';
  return `${s}..${t}`;
}

function renderRelationshipMeta(rel: Relationship, col: MetadataColumn): ReactNode {
  const v = getMetadataValue({ metadata: rel.metadata } as any, col.name);
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

interface SidePanelProps {
  rel: Relationship;
  entityMap: EntityLookup;
  currentService: string;
  entityName: string;
  metaColumns: MetadataColumn[];
  onClose: () => void;
  onSave: (patch: Partial<Relationship>) => Promise<void>;
  onMetadataChange: (col: MetadataColumn, value: string | number | boolean) => void;
}

const RelationshipSidePanel = ({
  rel,
  entityMap,
  currentService,
  entityName,
  metaColumns,
  onClose,
  onSave,
  onMetadataChange,
}: SidePanelProps) => {
  const [srcCard, setSrcCard] = useState<Cardinality>(rel.source.cardinality);
  const [tgtCard, setTgtCard] = useState<Cardinality>(rel.target.cardinality);
  const [description, setDescription] = useState(rel.description || '');
  const [type, setType] = useState<RelationshipType>(rel.type || 'structural');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setSrcCard(rel.source.cardinality);
    setTgtCard(rel.target.cardinality);
    setDescription(rel.description || '');
    setType(rel.type || 'structural');
    setSavedAt(null);
  }, [rel.uuid]);

  const dirty =
    srcCard !== rel.source.cardinality ||
    tgtCard !== rel.target.cardinality ||
    description !== (rel.description || '') ||
    type !== (rel.type || 'structural');

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave({
        source: { ...rel.source, cardinality: srcCard },
        target: { ...rel.target, cardinality: tgtCard },
        description: description || undefined,
        type,
      });
      setSavedAt(Date.now());
    } catch (err) {
      console.error('Failed to save relationship:', err);
    } finally {
      setSaving(false);
    }
  };

  const fromInfo = entityMap[rel.source.entity];
  const toInfo = entityMap[rel.target.entity];
  const fromLabel = fromInfo?.name || rel.source.name || rel.source.entity;
  const toLabel = toInfo?.name || rel.target.name || rel.target.entity;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 40 }}
      />
      <aside
        role="dialog"
        aria-label="Edit relationship"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0,
          width: 480,
          background: 'var(--bg-raised)',
          borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 50,
          animation: 'sddSlide 220ms ease-out',
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
            edit relationship
          </span>
          <div style={{ flex: 1 }} />
          <Link to={`/packages/${currentService}/entities/${entityName}/relationships/${rel.uuid}/edit`}>
            <Button size="sm" variant="ghost" icon="edit">Full editor</Button>
          </Link>
          <Button size="sm" variant="ghost" icon="close" onClick={onClose} iconOnly aria-label="close" />
        </div>

        <div
          style={{
            padding: '10px 14px 6px',
            borderBottom: '1px solid var(--border)',
            fontSize: 'var(--fs-sm)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontWeight: 500 }}>{fromLabel}</span>
            <Icon name="chevronR" size={12} style={{ color: 'var(--text-subtle)' }} />
            <span className="mono" style={{ fontWeight: 500 }}>{toLabel}</span>
            {toInfo && toInfo.service !== currentService && (
              <Chip tone="info" dashed className="mono" title={`in ${toInfo.service}`}>xsvc</Chip>
            )}
          </div>
          <div
            className="mono"
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginTop: 4 }}
          >
            {cardinalityPill(srcCard, tgtCard)} · {type}
          </div>
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
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Source cardinality" grow>
              <select
                value={srcCard}
                onChange={(e) => setSrcCard(e.target.value as Cardinality)}
                style={fieldStyleMono}
              >
                <option value={Cardinality.ONE}>one</option>
                <option value={Cardinality.MANY}>many</option>
              </select>
            </Field>
            <Field label="Target cardinality" grow>
              <select
                value={tgtCard}
                onChange={(e) => setTgtCard(e.target.value as Cardinality)}
                style={fieldStyleMono}
              >
                <option value={Cardinality.ONE}>one</option>
                <option value={Cardinality.MANY}>many</option>
              </select>
            </Field>
          </div>

          <Field label="Type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as RelationshipType)}
              style={fieldStyleMono}
            >
              <option value="structural">structural</option>
              <option value="lineage">lineage</option>
            </select>
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ ...fieldStyle, minHeight: 60, padding: '6px 8px', fontFamily: 'inherit' }}
            />
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
                    value={getMetadataValue({ metadata: rel.metadata } as any, col.name)}
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
        </div>
      </aside>
    </>
  );
};

// ──────────────── Field primitives ────────────────

interface FieldProps {
  label: string;
  grow?: boolean;
  children: ReactNode;
}

const Field = ({ label, grow, children }: FieldProps) => (
  <label
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      flex: grow ? 1 : undefined,
    }}
  >
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{label}</span>
    {children}
  </label>
);

interface MetadataFieldProps {
  column: MetadataColumn;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
}

const MetadataField = ({ column, value, onChange }: MetadataFieldProps) => {
  if (column.type === 'flag' || column.type === 'boolean') {
    return (
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 'var(--fs-xs)',
          color: 'var(--text-muted)',
        }}
      >
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        {column.label} · {column.stereotypeName}
      </label>
    );
  }
  return (
    <Field label={`${column.label} · ${column.stereotypeName}`}>
      <input
        type="text"
        value={value === undefined ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        style={fieldStyle}
      />
    </Field>
  );
};

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

export default RelationshipList;
