import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Attribute, AttributeType, Entity, Rule, RuleSeverityValue } from '../types';
import {
  useStereotypeMetadata,
  getMetadataValue,
  setMetadataValue,
} from '../hooks/useStereotypeMetadata';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import RulesSidePanel from './RulesSidePanel';
import { servicesApi, ruleApi } from '../services/api';
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
 * AttributeList — Phase 4.1 redesign.
 *
 * Visual grammar follows design_handoff README §Core (standard-vs-metadata
 * split) plus Toolbar → DataTable → ColumnChooser wiring.
 *
 * Edit pattern for Calm: side-panel slide-over from the right (480px).
 * Inline-editing has been retired; all writes go through the panel,
 * which delegates to the same `servicesApi.updateEntity` call that
 * the old inline cells used, so every backend path is preserved.
 */

interface AttributeListProps {
  attributes: Attribute[];
  entityName: string;
  /** UUID of the parent entity — required to fetch rules touching this entity (#76) */
  entityUuid?: string;
  serviceName: string;
  onAttributeUpdated?: () => void;
}

const severityRank: Record<RuleSeverityValue, number> = { error: 3, warning: 2, info: 1 };

/** Map a PII metadata value to the Chip primitive's typed shape. */
const PII_SHAPES: Record<string, 'direct' | 'indirect' | 'possible'> = {
  direct:   'direct',
  indirect: 'indirect',
  possible: 'possible',
  true:     'direct',
};
function piiOf(attr: Attribute): 'direct' | 'indirect' | 'possible' | null {
  const raw = getMetadataValue(attr, 'pii');
  if (raw === undefined || raw === null || raw === false || raw === '') return null;
  const key = String(raw).toLowerCase();
  return PII_SHAPES[key] ?? 'possible';
}

function maxSeverity(rules: Rule[]): RuleSeverityValue | null {
  if (rules.length === 0) return null;
  return rules.reduce<RuleSeverityValue>(
    (max, r) => (severityRank[r.severity] > severityRank[max] ? r.severity : max),
    'info',
  );
}

const SEVERITY_TONE: Record<RuleSeverityValue, 'danger' | 'warning' | 'info'> = {
  error:   'danger',
  warning: 'warning',
  info:    'info',
};

const ATTR_COL_KEY = 'attribute-list-columns-v2';

interface DraftAttribute {
  id: string;
  name: string;
  type: AttributeType;
  description: string;
  required: boolean;
}

const emptyDraft = (): DraftAttribute => ({
  id: crypto.randomUUID(),
  name: '',
  type: AttributeType.STRING,
  description: '',
  required: false,
});

const AttributeList = ({
  attributes,
  entityName,
  entityUuid,
  serviceName,
  onAttributeUpdated,
}: AttributeListProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<AttributeType | 'all'>('all');
  const { allColumns } = useStereotypeMetadata('attribute');

  // Metadata column visibility — persisted locally.
  const [metaVisible, setMetaVisible] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(ATTR_COL_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set<string>();
  });

  useEffect(() => {
    if (attributes.length > 0 && allColumns.length > 0 && metaVisible.size === 0) {
      const used = new Set<string>();
      for (const attr of attributes) {
        for (const entry of attr.metadata || []) {
          if (allColumns.some(c => c.name === entry.name)) used.add(entry.name);
        }
      }
      if (used.size > 0) setMetaVisible(used);
    }
  }, [attributes, allColumns]);

  useEffect(() => {
    localStorage.setItem(ATTR_COL_KEY, JSON.stringify([...metaVisible]));
  }, [metaVisible]);

  // Rules for this entity (#76).
  const [entityRules, setEntityRules] = useState<Rule[]>([]);
  const [sidePanelAttr, setSidePanelAttr] = useState<Attribute | null>(null);
  const [editAttr, setEditAttr] = useState<Attribute | null>(null);

  // Drafts are added via the side-panel "Add attribute" button.
  const [drafts, setDrafts] = useState<DraftAttribute[]>([]);
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState<Set<string | number>>(() => new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  const fetchEntityRules = useCallback(async () => {
    if (!entityUuid) return;
    try {
      const rules = await ruleApi.getRulesForEntity(entityUuid);
      setEntityRules(rules);
    } catch (err) {
      console.error('Failed to fetch entity rules:', err);
      setEntityRules([]);
    }
  }, [entityUuid]);

  useEffect(() => {
    fetchEntityRules();
  }, [fetchEntityRules]);

  const rulesByAttrUuid = useMemo(() => {
    const map = new Map<string, Rule[]>();
    for (const rule of entityRules) {
      for (const target of rule.targets || []) {
        if (target.kind === 'attribute' && target.uuid) {
          const list = map.get(target.uuid) || [];
          list.push(rule);
          map.set(target.uuid, list);
        }
      }
    }
    return map;
  }, [entityRules]);

  const activeMetaColumns = allColumns.filter(c => metaVisible.has(c.name));

  const filteredAttributes = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return attributes.filter(attr => {
      const matchesSearch = !needle
        || attr.name.toLowerCase().includes(needle)
        || (attr.description || '').toLowerCase().includes(needle);
      const matchesType = filterType === 'all' || attr.type === filterType;
      return matchesSearch && matchesType;
    });
  }, [attributes, searchTerm, filterType]);

  // ──────────────── Save paths (unchanged semantics) ────────────────

  const saveAttributeField = useCallback(async (
    attr: Attribute,
    updater: (a: Attribute) => Attribute,
  ) => {
    const response = await servicesApi.getEntitySchema(serviceName, entityName);
    const entity: Entity = response.data;
    const attrIndex = entity.attributes.findIndex(a => a.uuid === attr.uuid);
    if (attrIndex < 0) throw new Error('Attribute not found');
    entity.attributes[attrIndex] = updater(entity.attributes[attrIndex]);
    await servicesApi.updateEntity(serviceName, entityName, entity);
    onAttributeUpdated?.();
  }, [serviceName, entityName, onAttributeUpdated]);

  const handleMetadataChange = useCallback(async (
    attr: Attribute,
    column: MetadataColumn,
    value: string | number | boolean,
  ) => {
    try {
      await saveAttributeField(attr, (a) => ({
        ...a,
        metadata: setMetadataValue(a.metadata, column.name, value),
      }));
    } catch (err) {
      console.error('Failed to update metadata:', err);
    }
  }, [saveAttributeField]);

  const saveDrafts = useCallback(async () => {
    const valid = drafts.filter(d => d.name.trim());
    if (valid.length === 0) return;
    setSaving(true);
    try {
      const response = await servicesApi.getEntitySchema(serviceName, entityName);
      const entity = response.data;
      for (const draft of valid) {
        entity.attributes.push({
          uuid: crypto.randomUUID(),
          name: draft.name.trim(),
          type: draft.type,
          description: draft.description.trim(),
          required: draft.required,
        });
      }
      await servicesApi.updateEntity(serviceName, entityName, entity);
      setDrafts([]);
      onAttributeUpdated?.();
    } catch (err) {
      console.error('Failed to save attributes:', err);
    } finally {
      setSaving(false);
    }
  }, [drafts, serviceName, entityName, onAttributeUpdated]);

  // Drop stale uuids from the selection when attributes refresh — either
  // because the user deleted them or because another client did.
  useEffect(() => {
    setSelection(prev => {
      if (prev.size === 0) return prev;
      const alive = new Set(attributes.map(a => a.uuid));
      let changed = false;
      const next = new Set<string | number>();
      for (const k of prev) {
        if (alive.has(String(k))) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [attributes]);

  // ──────────────── Bulk mutations ────────────────
  //
  // Every batch action fetches the entity once, applies N attribute-level
  // mutations in-memory, then writes back with a single updateEntity call.
  // Keeping it to one round-trip avoids both the N+1 pattern and the
  // half-applied state that would result from a partial failure.
  const applyToSelection = useCallback(async (
    mutate: (a: Attribute) => Attribute | null, // return null to delete
  ) => {
    if (selection.size === 0) return;
    setBulkSaving(true);
    try {
      const response = await servicesApi.getEntitySchema(serviceName, entityName);
      const entity: Entity = response.data;
      const targets = new Set(Array.from(selection).map(String));
      const nextAttrs: Attribute[] = [];
      for (const a of entity.attributes) {
        if (!targets.has(a.uuid)) {
          nextAttrs.push(a);
          continue;
        }
        const next = mutate(a);
        if (next !== null) nextAttrs.push(next);
      }
      entity.attributes = nextAttrs;
      await servicesApi.updateEntity(serviceName, entityName, entity);
      onAttributeUpdated?.();
    } catch (err) {
      console.error('Bulk update failed:', err);
    } finally {
      setBulkSaving(false);
    }
  }, [selection, serviceName, entityName, onAttributeUpdated]);

  const handleBulkSetRequired = useCallback((required: boolean) => {
    return applyToSelection(a => ({ ...a, required }));
  }, [applyToSelection]);

  // PII is stored as an attribute metadata entry keyed "pii". Writing
  // through setMetadataValue preserves the rest of the metadata array
  // and matches the single-attribute path used by the side panel.
  const handleBulkSetPii = useCallback((value: 'direct' | '') => {
    return applyToSelection(a => ({
      ...a,
      metadata: setMetadataValue(a.metadata, 'pii', value),
    }));
  }, [applyToSelection]);

  const handleBulkDelete = useCallback(async () => {
    const n = selection.size;
    if (n === 0) return;
    const ok = window.confirm(
      `Delete ${n} attribute${n === 1 ? '' : 's'}? This cannot be undone.`,
    );
    if (!ok) return;
    await applyToSelection(() => null);
    setSelection(new Set());
  }, [applyToSelection, selection]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.includes('\t') && !text.includes(',')) return;
    e.preventDefault();
    const sep = text.includes('\t') ? '\t' : ',';
    const lines = text.split('\n').filter(l => l.trim());
    const newDrafts: DraftAttribute[] = lines.map(line => {
      const cols = line.split(sep).map(c => c.trim());
      const typeVal = (cols[1] || 'string').toLowerCase();
      const matchedType = Object.values(AttributeType).find(t => t === typeVal) || AttributeType.STRING;
      return {
        id: crypto.randomUUID(),
        name: cols[0] || '',
        type: matchedType,
        description: cols[2] || '',
        required: ['yes', 'true', '1'].includes((cols[3] || '').toLowerCase()),
      };
    }).filter(d => d.name);
    if (newDrafts.length > 0) setDrafts(prev => [...prev, ...newDrafts]);
  }, []);

  // ──────────────── Columns ────────────────

  const columns: ColumnDef<Attribute>[] = useMemo(() => {
    const std: ColumnDef<Attribute>[] = [
      {
        key: 'name',
        header: 'Name',
        group: 'standard',
        mono: true,
        sortable: true,
        filterable: true,
        width: 'minmax(160px, 1.4fr)',
        accessor: (a) => a.name,
        render: (a) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, overflow: 'hidden', minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{a.name}</span>
            {a.primaryKey && <Icon name="key" size={11} style={{ color: 'var(--warning)' }} />}
          </span>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        group: 'standard',
        sortable: true,
        filterable: true,
        width: 130,
        accessor: (a) => a.type,
        render: (a) => <TypeChip type={a.type} />,
      },
      {
        key: 'required',
        header: 'Required',
        group: 'standard',
        sortable: true,
        width: 90,
        align: 'center',
        accessor: (a) => a.required,
        render: (a) => a.required
          ? <Chip tone="accent" soft>yes</Chip>
          : <span style={{ color: 'var(--text-subtle)' }}>—</span>,
      },
      {
        key: 'default',
        header: 'Default',
        group: 'standard',
        width: 120,
        mono: true,
        accessor: (a) => (a.defaultValue === undefined || a.defaultValue === null)
          ? ''
          : String(a.defaultValue),
        render: (a) => a.defaultValue === undefined || a.defaultValue === null
          ? <span style={{ color: 'var(--text-subtle)' }}>—</span>
          : <span className="mono" style={{ fontSize: 'var(--fs-sm)' }}>{String(a.defaultValue)}</span>,
      },
      {
        key: 'description',
        header: 'Description',
        group: 'standard',
        filterable: true,
        width: 'minmax(240px, 2fr)',
        accessor: (a) => a.description || '',
        render: (a) => a.description
          ? <span style={{ color: 'var(--text-muted)' }}>{a.description}</span>
          : <span style={{ color: 'var(--text-subtle)', fontStyle: 'italic' }}>no description</span>,
      },
      {
        key: 'rules',
        header: 'Rules',
        group: 'standard',
        width: 80,
        align: 'center',
        accessor: (a) => (rulesByAttrUuid.get(a.uuid)?.length ?? 0),
        render: (a) => {
          const attrRules = rulesByAttrUuid.get(a.uuid) || [];
          if (attrRules.length === 0) {
            return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
          }
          const sev = maxSeverity(attrRules)!;
          return (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setSidePanelAttr(a); }}
              style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
              title={`${attrRules.length} rule${attrRules.length === 1 ? '' : 's'}`}
            >
              <Chip tone={SEVERITY_TONE[sev]} soft>{attrRules.length}</Chip>
            </button>
          );
        },
      },
    ];

    const meta: ColumnDef<Attribute>[] = activeMetaColumns.map((col) => ({
      key: `meta:${col.name}`,
      header: col.label,
      group: 'metadata',
      width: col.name === 'pii' ? 110 : 120,
      accessor: (a) => {
        const v = getMetadataValue(a, col.name);
        return v === undefined ? '' : (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
      },
      render: (a) => renderMetadataCell(a, col),
    }));

    return [...std, ...meta];
  }, [activeMetaColumns, rulesByAttrUuid]);

  // ──────────────── Render ────────────────

  const chooserCols = useMemo(() => columns as unknown as ColumnDef<unknown>[], [columns]);
  const allVisibleKeys = useMemo(() => {
    // Standard columns are always on; metadata toggles flow through metaVisible.
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
    <div className="flex flex-col gap-2" onPaste={handlePaste}>
      <Toolbar attached>
        <Input
          icon="search"
          size="sm"
          placeholder="Search attributes…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.currentTarget.value)}
          width={260}
        />
        <TypeFilter value={filterType} onChange={setFilterType} />
        <ColumnChooser
          columns={chooserCols}
          visible={allVisibleKeys}
          onChange={handleVisibleChange}
        />
        <Toolbar.Spacer />
        <Button
          size="md"
          variant="secondary"
          icon="plus"
          onClick={() => setDrafts(prev => [...prev, emptyDraft()])}
        >
          Add row
        </Button>
        <Button
          size="md"
          variant="primary"
          icon="edit"
          disabled={attributes.length === 0}
          onClick={() => setEditAttr(attributes[0] ?? null)}
        >
          Quick edit
        </Button>
      </Toolbar>

      <DataTable<Attribute>
        columns={columns}
        rows={filteredAttributes}
        getRowKey={(a) => a.uuid}
        visibleColumns={allVisibleKeys}
        onVisibleColumnsChange={handleVisibleChange}
        onRowClick={(a) => setEditAttr(a)}
        selection={selection}
        onSelectionChange={setSelection}
        showFilterRow
        attached
        emptyMessage={
          attributes.length === 0
            ? 'No attributes yet. Click "Add row" to create one.'
            : 'No attributes match these filters.'
        }
      />

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
          {
            label: 'Delete',
            icon: 'close',
            tone: 'danger',
            disabled: bulkSaving,
            onClick: handleBulkDelete,
          },
        ]}
      />

      {/* Draft rows (bulk add / paste from Excel) */}
      {drafts.length > 0 && (
        <div
          style={{
            background: 'var(--bg-raised)',
            border: '2px dashed var(--accent)',
            borderRadius: 'var(--radius-md)',
            padding: 8,
          }}
        >
          <div
            className="uppercase"
            style={{
              fontSize: 'var(--fs-xs)',
              color: 'var(--accent)',
              letterSpacing: '0.04em',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            New attributes ({drafts.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {drafts.map((d, idx) => (
              <DraftRow
                key={d.id}
                draft={d}
                autoFocus={idx === drafts.length - 1}
                onChange={(patch) => setDrafts(prev => prev.map(x => x.id === d.id ? { ...x, ...patch } : x))}
                onRemove={() => setDrafts(prev => prev.filter(x => x.id !== d.id))}
                onAddAnother={() => setDrafts(prev => [...prev, emptyDraft()])}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Button
              size="sm"
              variant="primary"
              icon="check"
              disabled={saving || drafts.every(d => !d.name.trim())}
              onClick={saveDrafts}
            >
              {saving ? 'Saving…' : `Save ${drafts.filter(d => d.name.trim()).length}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDrafts([])}>Discard</Button>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', alignSelf: 'center' }}>
              Tip: paste from Excel (name, type, description, required)
            </span>
          </div>
        </div>
      )}

      {/* Side panel — the Calm edit pattern. */}
      {editAttr && (
        <AttributeSidePanel
          attr={editAttr}
          metaColumns={allColumns}
          entityName={entityName}
          serviceName={serviceName}
          onClose={() => setEditAttr(null)}
          onSave={async (patch) => {
            await saveAttributeField(editAttr, (a) => ({ ...a, ...patch }));
          }}
          onMetadataChange={(col, value) => handleMetadataChange(editAttr, col, value)}
          onOpenRules={() => { setSidePanelAttr(editAttr); }}
        />
      )}

      <RulesSidePanel
        title={sidePanelAttr ? `Rules for ${entityName}.${sidePanelAttr.name}` : 'Rules'}
        rules={sidePanelAttr ? rulesByAttrUuid.get(sidePanelAttr.uuid) || [] : []}
        open={sidePanelAttr !== null}
        onClose={() => setSidePanelAttr(null)}
        onRulesChanged={() => {
          fetchEntityRules();
          onAttributeUpdated?.();
        }}
      />
    </div>
  );
};

// ──────────────── Pieces ────────────────

function renderMetadataCell(attr: Attribute, col: MetadataColumn): ReactNode {
  if (col.name === 'pii') {
    return <PiiChip value={piiOf(attr)} />;
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

interface TypeFilterProps {
  value: AttributeType | 'all';
  onChange: (v: AttributeType | 'all') => void;
}

const TypeFilter = ({ value, onChange }: TypeFilterProps) => (
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
      onChange={(e) => onChange(e.target.value as AttributeType | 'all')}
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
      <option value="all">all types</option>
      {Object.values(AttributeType).map(t => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  </label>
);

interface DraftRowProps {
  draft: DraftAttribute;
  autoFocus?: boolean;
  onChange: (patch: Partial<DraftAttribute>) => void;
  onRemove: () => void;
  onAddAnother: () => void;
}

const DraftRow = ({ draft, autoFocus, onChange, onRemove, onAddAnother }: DraftRowProps) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '160px 130px 1fr 80px auto',
      gap: 6,
      alignItems: 'center',
    }}
  >
    <input
      type="text"
      placeholder="attributeName"
      value={draft.name}
      autoFocus={autoFocus}
      onChange={(e) => onChange({ name: e.target.value })}
      onKeyDown={(e) => { if (e.key === 'Enter') onAddAnother(); }}
      style={fieldStyle}
    />
    <select
      value={draft.type}
      onChange={(e) => onChange({ type: e.target.value as AttributeType })}
      style={fieldStyle}
    >
      {Object.values(AttributeType).map(t => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
    <input
      type="text"
      placeholder="Description"
      value={draft.description}
      onChange={(e) => onChange({ description: e.target.value })}
      style={fieldStyle}
    />
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
      <input
        type="checkbox"
        checked={draft.required}
        onChange={(e) => onChange({ required: e.target.checked })}
      />
      required
    </label>
    <Button size="sm" variant="ghost" icon="close" onClick={onRemove} aria-label="remove draft" iconOnly />
  </div>
);

// ──────────────── Side panel ────────────────

interface SidePanelProps {
  attr: Attribute;
  metaColumns: MetadataColumn[];
  entityName: string;
  serviceName: string;
  onClose: () => void;
  onSave: (patch: Partial<Attribute>) => Promise<void>;
  onMetadataChange: (col: MetadataColumn, value: string | number | boolean) => void;
  onOpenRules: () => void;
}

const AttributeSidePanel = ({
  attr,
  metaColumns,
  entityName,
  serviceName,
  onClose,
  onSave,
  onMetadataChange,
  onOpenRules,
}: SidePanelProps) => {
  const [name, setName] = useState(attr.name);
  const [type, setType] = useState<AttributeType>(attr.type);
  const [description, setDescription] = useState(attr.description || '');
  const [required, setRequired] = useState(!!attr.required);
  const [defaultValue, setDefaultValue] = useState<string>(
    attr.defaultValue === undefined || attr.defaultValue === null ? '' : String(attr.defaultValue),
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Re-hydrate when switching rows.
  useEffect(() => {
    setName(attr.name);
    setType(attr.type);
    setDescription(attr.description || '');
    setRequired(!!attr.required);
    setDefaultValue(
      attr.defaultValue === undefined || attr.defaultValue === null ? '' : String(attr.defaultValue),
    );
    setSavedAt(null);
  }, [attr.uuid]);

  const dirty =
    name !== attr.name ||
    type !== attr.type ||
    description !== (attr.description || '') ||
    required !== !!attr.required ||
    defaultValue !== (attr.defaultValue === undefined || attr.defaultValue === null ? '' : String(attr.defaultValue));

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

        {/* Panel header */}
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
            {attr.name}
          </span>
          <div style={{ flex: 1 }} />
          <Link to={`/packages/${serviceName}/entities/${entityName}/attributes/${attr.name}/edit`}>
            <Button size="sm" variant="ghost" icon="edit">Full editor</Button>
          </Link>
          <Button size="sm" variant="ghost" icon="close" onClick={onClose} iconOnly aria-label="close" />
        </div>

        {/* Form */}
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
              onChange={(e) => setName(e.target.value)}
              style={fieldStyleMono}
            />
          </Field>
          <Field label="Type">
            <select
              value={type}
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
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ ...fieldStyle, minHeight: 60, padding: '6px 8px', fontFamily: 'inherit' }}
            />
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Required" inline>
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
            </Field>
            <Field label="Default value" grow>
              <input
                type="text"
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                style={fieldStyleMono}
              />
            </Field>
          </div>

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
                    value={getMetadataValue(attr, col.name)}
                    onChange={(v) => onMetadataChange(col, v)}
                  />
                ))}
              </div>
            </div>
          )}

          <div style={{ paddingTop: 4 }}>
            <Button size="sm" variant="ghost" icon="shield" onClick={onOpenRules}>
              Manage rules / constraints
            </Button>
          </div>
        </div>

        {/* Panel footer */}
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

interface MetadataFieldProps {
  column: MetadataColumn;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean) => void;
}

const MetadataField = ({ column, value, onChange }: MetadataFieldProps) => {
  if (column.type === 'flag' || column.type === 'boolean') {
    return (
      <Field label={`${column.label} · ${column.stereotypeName}`} inline>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
      </Field>
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

// ──────────────── Styles ────────────────

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

export default AttributeList;
