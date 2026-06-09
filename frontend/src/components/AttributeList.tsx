import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Attribute, AttributeType, Entity, Rule, RuleSeverityValue } from '../types';
import {
  useStereotypeMetadata,
  getMetadataValue,
  setMetadataValue,
} from '../hooks/useStereotypeMetadata';
import type { MetadataColumn } from '../hooks/useStereotypeMetadata';
import RulesSidePanel from '../plugins/data-dictionary/components/rules/RulesSidePanel';
import AttributeSidePanel from './AttributeSidePanel';
import { servicesApi, configApi, type DerivedType, type ValueDomainKind } from '../services/api';
import { useService } from '../kernel/useService';
import { RULE_SERVICE_TOKEN } from '../kernel/tokens';
import type { RuleService } from '../plugins/data-dictionary/services/RuleService';
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
  TypeIcon,
} from './ui';
import type { ColumnDef } from './ui';

/**
 * AttributeList — Phase 4.1 redesign.
 *
 * Visual grammar: standard-vs-metadata split + Toolbar → DataTable →
 * ColumnChooser wiring (see /design-system).
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
const ATTR_OPTIONAL_COL_KEY = 'attribute-list-optional-columns-v1';

/**
 * Standard columns that are rendered as inline decorators on the name
 * cell by default (type chip + required asterisk + primary-key icon).
 * The user can still surface them as separate columns from the Column
 * chooser — opt-in, persisted per browser.
 */
const OPTIONAL_STD_COLS = new Set<string>(['type', 'required', 'default']);

interface DomainInfo {
  kind: ValueDomainKind;
  /** The derived type that carries the domain (link target for enum/codelist). */
  typeName: string;
  /** Domain source — code-list / data-source name or URL (codelist & reference). */
  source?: string;
  /** Static values (enum & codelist) — surfaced on hover. */
  values?: string[];
}

const isUrl = (s?: string) => !!s && /^https?:\/\//i.test(s);

/**
 * Values-column cell for a domain-bearing attribute.
 *  - enum / codelist → the type name, linked to its definition; hover lists the values.
 *  - reference       → the source, linked only when it is a URL or a known type
 *                      (otherwise plain text — there is nothing to navigate to).
 */
const DomainSource = ({ info, known }: { info: DomainInfo; known: boolean }) => {
  const hover = info.values && info.values.length > 0 ? info.values.join(', ') : undefined;

  if (info.kind === 'reference') {
    const src = info.source;
    const detail = `Reference → ${src || '(no source)'}`;
    if (isUrl(src)) {
      return (
        <a href={src} target="_blank" rel="noopener noreferrer" className="mono"
          style={{ color: 'var(--accent)' }} title={detail} onClick={(e) => e.stopPropagation()}>
          {src}
        </a>
      );
    }
    if (known && src) {
      return (
        <Link to={`/types?name=${encodeURIComponent(src)}`} className="mono"
          style={{ color: 'var(--accent)' }} title={`${detail} — open definition`} onClick={(e) => e.stopPropagation()}>
          {src}
        </Link>
      );
    }
    return <span className="mono" style={{ color: 'var(--text-muted)' }} title={detail}>{src || '—'}</span>;
  }

  // enum / codelist — always navigable to the type details; hover lists values.
  return (
    <Link to={`/types?name=${encodeURIComponent(info.typeName)}`} className="mono"
      style={{ color: 'var(--accent)' }} title={hover || 'Open type definition'} onClick={(e) => e.stopPropagation()}>
      {info.typeName}
    </Link>
  );
};

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
  const ruleService = useService<RuleService>(RULE_SERVICE_TOKEN);
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

  // Standard columns the user has opted to surface (type / required).
  // Default is empty → both render as inline decorators on the name cell.
  const [optionalVisible, setOptionalVisible] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(ATTR_OPTIONAL_COL_KEY);
      if (saved) return new Set(JSON.parse(saved));
    } catch { /* ignore */ }
    return new Set<string>();
  });

  useEffect(() => {
    localStorage.setItem(ATTR_OPTIONAL_COL_KEY, JSON.stringify([...optionalVisible]));
  }, [optionalVisible]);

  // Derived types — used to resolve an attribute's value domain (#TBD) for the
  // Values column (enum / codelist → link to the type details + hover values;
  // reference → link only when the source is a URL or a known type).
  const [derivedTypes, setDerivedTypes] = useState<DerivedType[]>([]);
  useEffect(() => {
    configApi.getDerivedTypes().then(setDerivedTypes).catch(() => { /* project may not be open */ });
  }, []);

  const resolveDomainInfo = useMemo(() => {
    const byName = new Map(derivedTypes.map((t) => [t.name, t] as const));
    const STD = new Set<string>(Object.values(AttributeType));
    const cache = new Map<string, DomainInfo | null>();
    return (typeName: string): DomainInfo | null => {
      if (cache.has(typeName)) return cache.get(typeName)!;
      let result: DomainInfo | null = null;
      const visited = new Set<string>();
      let cursor = typeName;
      while (!STD.has(cursor)) {
        if (visited.has(cursor)) break;
        visited.add(cursor);
        const dt = byName.get(cursor);
        if (!dt) break;
        if (dt.domain) {
          result = { kind: dt.domain.kind, typeName: dt.name, source: dt.domain.source, values: dt.domain.values };
          break;
        }
        cursor = dt.basedOn;
      }
      cache.set(typeName, result);
      return result;
    };
  }, [derivedTypes]);

  const isKnownType = useCallback(
    (name?: string) => !!name && derivedTypes.some((t) => t.name === name),
    [derivedTypes],
  );

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
      const rules = await ruleService.getRulesForEntity(entityUuid);
      setEntityRules(rules);
    } catch (err) {
      console.error('Failed to fetch entity rules:', err);
      setEntityRules([]);
    }
  }, [entityUuid, ruleService]);

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
        render: (a) => {
          // Decorators: type chip (when not surfaced as its own column) +
          // required asterisk (likewise) + primary-key icon. The chooser
          // lets the user promote type/required back into dedicated
          // columns; the decorators hide when the column is shown so
          // information isn't duplicated.
          const showTypeDecorator    = !optionalVisible.has('type');
          const showRequiredDecorator = !optionalVisible.has('required');
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, overflow: 'hidden', minWidth: 0 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{a.name}</span>
              {showRequiredDecorator && a.required && (
                <span
                  aria-label="required"
                  title="Required"
                  style={{ color: 'var(--error, var(--danger))', fontWeight: 700, fontSize: 'var(--fs-sm)', lineHeight: 1 }}
                >
                  *
                </span>
              )}
              {a.primaryKey && <Icon name="key" size={11} style={{ color: 'var(--warning)' }} />}
              {showTypeDecorator && <TypeIcon type={a.type} />}
            </span>
          );
        },
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
        key: 'values',
        header: 'Values',
        group: 'standard',
        filterable: true,
        width: 'minmax(90px, 0.7fr)',
        // A single compact element per row: a link to the domain's definition
        // (enum / codelist / reference) — the actual values and reference detail
        // live in the tooltip. Domainless inline enums show their values as a
        // truncated label with the full list on hover.
        accessor: (a) => {
          const d = resolveDomainInfo(a.type);
          if (d) return d.kind === 'reference' ? (d.source || '') : d.typeName;
          return (a.validation?.enumValues || []).join(', ');
        },
        render: (a) => {
          const d = resolveDomainInfo(a.type);
          if (d) return <DomainSource info={d} known={isKnownType(d.source)} />;

          const vals = a.validation?.enumValues || [];
          if (vals.length === 0) {
            return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
          }
          const joined = vals.join(', ');
          return (
            <span
              className="mono"
              title={joined}
              style={{
                display: 'block', overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)',
              }}
            >
              {joined}
            </span>
          );
        },
      },
      {
        key: 'description',
        header: 'Description',
        group: 'standard',
        filterable: true,
        width: 'minmax(320px, 3.2fr)',
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
  }, [activeMetaColumns, rulesByAttrUuid, optionalVisible, resolveDomainInfo, isKnownType]);

  // ──────────────── Render ────────────────

  const chooserCols = useMemo(() => columns as unknown as ColumnDef<unknown>[], [columns]);
  const allVisibleKeys = useMemo(() => {
    // Standard columns are on by default EXCEPT the opt-in ones
    // (`type`, `required`) — those flow through `optionalVisible` and
    // surface as decorators on the name cell when hidden.
    // Metadata toggles flow through `metaVisible`.
    const set = new Set<string>();
    for (const c of columns) {
      if ((c.group ?? 'standard') !== 'standard') continue;
      if (OPTIONAL_STD_COLS.has(c.key) && !optionalVisible.has(c.key)) continue;
      set.add(c.key);
    }
    for (const name of metaVisible) set.add(`meta:${name}`);
    return set;
  }, [columns, metaVisible, optionalVisible]);

  const handleVisibleChange = useCallback((next: Set<string>) => {
    const nextMeta = new Set<string>();
    const nextOptional = new Set<string>();
    next.forEach((key) => {
      if (key.startsWith('meta:')) nextMeta.add(key.slice(5));
      else if (OPTIONAL_STD_COLS.has(key)) nextOptional.add(key);
    });
    setMetaVisible(nextMeta);
    setOptionalVisible(nextOptional);
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
        resizeKey="attribute-list"
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

// ──────────────── Styles ────────────────
// Used by DraftRow above. The side-panel editor lives in
// ./AttributeSidePanel.tsx and owns its own field styles.

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

export default AttributeList;
