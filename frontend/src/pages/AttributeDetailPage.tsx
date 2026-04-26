/**
 * Attribute Detail page — Phase 5.1.
 *
 * Route: /packages/:pkg/entities/:entity/attributes/:attr
 *
 * Single-column shell per handoff README §10:
 *   - Identity header: attribute name in --fs-3xl mono, entity breadcrumb,
 *     actions
 *   - Key-facts strip: Type · Required · PII · Retention · Encrypted ·
 *     Physical sync
 *   - Collapsible sections: Description · Constraints · Governance ·
 *     Physical · Lineage · Used by · Activity
 *   - Each section has its own Edit button; editing keeps the section
 *     open; Save/Cancel pinned to the section header
 *
 * Every save path flows back through servicesApi.updateEntity (the same
 * call AttributeList uses) so no new backend is needed.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  servicesApi,
  relationshipApi,
  ruleApi,
} from '../services/api';
import {
  useStereotypeMetadata,
  getMetadataValue,
  setMetadataValue,
  type MetadataColumn,
} from '../hooks/useStereotypeMetadata';
import {
  Attribute,
  AttributeType,
  AttributeValidation,
  Entity,
  Relationship,
  Rule,
} from '../types';
import {
  Button,
  Chip,
  Icon,
  PageHeader,
  PiiChip,
  TypeChip,
} from '../components/ui';
import Breadcrumbs from '../components/Breadcrumbs';

const AttributeDetailPage = () => {
  const params = useParams<{ '*': string }>();
  const { service, entityName, attributeName } = parseParams(params['*'] || '');

  const [entity, setEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rels, setRels] = useState<Relationship[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const { allColumns: metaColumns } = useStereotypeMetadata('attribute');

  const load = useCallback(async (showLoader = true) => {
    if (!service || !entityName) return;
    try {
      if (showLoader) setLoading(true);
      const res = await servicesApi.getEntitySchema(service, entityName);
      setEntity(res.data);
    } catch {
      setError('Failed to load attribute.');
    } finally {
      setLoading(false);
    }
  }, [service, entityName]);

  useEffect(() => { load(); }, [load]);

  // Relationships + rules — used by "Used by" section.
  useEffect(() => {
    if (!service) return;
    relationshipApi.getPackageRelationships(service)
      .then(setRels)
      .catch(() => setRels([]));
  }, [service]);

  useEffect(() => {
    if (!entity?.uuid) return;
    ruleApi.getRulesForEntity(entity.uuid).then(setRules).catch(() => setRules([]));
  }, [entity?.uuid]);

  const attribute = useMemo<Attribute | null>(
    () => entity?.attributes.find(a => a.name === attributeName) ?? null,
    [entity, attributeName],
  );

  // Save a field on the attribute.
  const saveAttribute = useCallback(async (updater: (a: Attribute) => Attribute) => {
    if (!service || !entity || !attribute) return;
    const updatedEntity: Entity = {
      ...entity,
      attributes: entity.attributes.map(a =>
        a.uuid === attribute.uuid ? updater(a) : a,
      ),
    };
    await servicesApi.updateEntity(service, entity.name, updatedEntity);
    await load(false);
  }, [service, entity, attribute, load]);

  if (loading) {
    return (
      <div className="flex justify-center items-center" style={{ padding: 60 }}>
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (error || !entity || !attribute) {
    return (
      <div style={{ padding: 12 }}>
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--warning-soft)',
            color: 'var(--warning)',
            border: '1px solid var(--warning)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="warning" size={14} />
          {error ?? (
            entity
              ? `Attribute "${attributeName}" not found on ${entity.name}.`
              : 'Attribute not found.'
          )}
        </div>
      </div>
    );
  }

  // Used-by aggregations.
  const relsUsing = rels.filter(r =>
    r.source.entity === entity.uuid && r.source.referenceAttributes?.includes(attribute.name)
    || r.target.entity === entity.uuid && r.target.referenceAttributes?.includes(attribute.name),
  );

  const rulesUsing = rules.filter(r =>
    r.targets?.some(t => t.kind === 'attribute' && t.uuid === attribute.uuid),
  );

  // Physical metadata keys (anything whose name starts with `physical.`).
  const physicalKeys = (attribute.metadata || []).filter(m => m.name.startsWith('physical.'));
  const governanceMeta = metaColumns.filter(c =>
    // Anything that's not physical.* and not one of the key-facts pulled out above
    !['pii', 'retention', 'encrypted'].includes(c.name) && !c.name.startsWith('physical.'),
  );

  return (
    <div className="flex flex-col gap-3" style={{ padding: '4px 12px 12px' }}>
      <PageHeader
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: 'Home', path: '/' },
              { label: 'packages', path: '/packages' },
              { label: service ?? '', path: `/packages/${service}` },
              { label: entity.name, path: `/packages/${service}/entities/${entity.name}` },
              { label: attribute.name, path: `/packages/${service}/entities/${entity.name}/attributes/${attribute.name}` },
            ]}
          />
        }
        meta={
          <>
            {attribute.primaryKey && <Chip tone="warning" soft>PK</Chip>}
            {attribute.unique && <Chip tone="accent" soft>unique</Chip>}
          </>
        }
        actions={
          <>
            <Link to={`/packages/${service}/entities/${entity.name}`}>
              <Button size="sm" variant="ghost" icon="chevron">Back to entity</Button>
            </Link>
            <Link to={`/packages/${service}/entities/${entity.name}/attributes/${attribute.name}/edit`}>
              <Button size="sm" variant="secondary" icon="edit">Form editor</Button>
            </Link>
          </>
        }
      />

      {/* Key-facts strip */}
      <KeyFacts attribute={attribute} />

      {/* Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <DescriptionSection
          value={attribute.description || ''}
          onSave={(description) => saveAttribute(a => ({ ...a, description }))}
        />
        <ConstraintsSection
          attribute={attribute}
          onSave={(validation) => saveAttribute(a => ({ ...a, validation }))}
        />
        <GovernanceSection
          attribute={attribute}
          columns={governanceMeta}
          onSave={(col, value) => saveAttribute(a => ({
            ...a,
            metadata: setMetadataValue(a.metadata, col.name, value),
          }))}
        />
        <PhysicalSection
          attribute={attribute}
          existingKeys={physicalKeys.map(k => k.name)}
          onSave={(patch) => saveAttribute(a => ({
            ...a,
            metadata: Object.entries(patch).reduce(
              (acc, [k, v]) => setMetadataValue(acc, k, v),
              a.metadata,
            ),
          }))}
        />
        <LineageSection attribute={attribute} entity={entity} />
        <UsedBySection
          service={service}
          entity={entity}
          rels={relsUsing}
          rules={rulesUsing}
        />
        <ActivitySection entity={entity} />
      </div>
    </div>
  );
};

function parseParams(path: string): { service?: string; entityName?: string; attributeName?: string } {
  const segments = path.split('/').filter(Boolean);
  const entIdx = segments.indexOf('entities');
  const attrIdx = segments.indexOf('attributes');
  return {
    service: entIdx > 0 ? segments.slice(0, entIdx).join('/') : undefined,
    entityName: entIdx >= 0 ? segments[entIdx + 1] : undefined,
    attributeName: attrIdx >= 0 ? segments[attrIdx + 1] : undefined,
  };
}

// ──────────────── Key facts strip ────────────────

const KeyFacts = ({ attribute }: { attribute: Attribute }) => {
  const pii = (() => {
    const v = getMetadataValue(attribute, 'pii');
    if (!v) return null;
    const s = String(v).toLowerCase();
    if (s === 'direct' || s === 'indirect' || s === 'possible') return s;
    return 'possible';
  })() as 'direct' | 'indirect' | 'possible' | null;

  const retention = getMetadataValue(attribute, 'retention');
  const encrypted = getMetadataValue(attribute, 'encrypted');
  const physicalType = getMetadataValue(attribute, 'physical.dbType');

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 8,
      }}
    >
      <Fact label="Type">
        <TypeChip type={attribute.type} />
      </Fact>
      <Fact label="Required">
        {attribute.required
          ? <Chip tone="accent" soft>yes</Chip>
          : <span style={{ color: 'var(--text-subtle)' }}>—</span>}
      </Fact>
      <Fact label="PII">
        <PiiChip value={pii} />
      </Fact>
      <Fact label="Retention">
        {retention
          ? <span className="mono">{String(retention)}</span>
          : <span style={{ color: 'var(--text-subtle)' }}>—</span>}
      </Fact>
      <Fact label="Encrypted">
        {encrypted
          ? <Chip tone="success" soft>yes</Chip>
          : <span style={{ color: 'var(--text-subtle)' }}>—</span>}
      </Fact>
      <Fact label="Physical sync">
        {physicalType
          ? <span className="mono" style={{ color: 'var(--text-muted)' }}>{String(physicalType)}</span>
          : <span style={{ color: 'var(--text-subtle)' }}>—</span>}
      </Fact>
    </div>
  );
};

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div
    style={{
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: '8px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}
  >
    <div
      className="uppercase"
      style={{
        fontSize: 'var(--fs-xs)',
        color: 'var(--text-subtle)',
        letterSpacing: '0.06em',
        fontWeight: 600,
      }}
    >
      {label}
    </div>
    {children}
  </div>
);

// ──────────────── Section shell ────────────────

interface SectionProps {
  title: string;
  subtitle?: string;
  editable?: boolean;
  initiallyOpen?: boolean;
  editing?: boolean;
  onEditToggle?: () => void;
  onCancel?: () => void;
  onSave?: () => void | Promise<void>;
  savingDisabled?: boolean;
  children: ReactNode;
}

const Section = ({
  title,
  subtitle,
  editable,
  initiallyOpen = true,
  editing,
  onEditToggle,
  onCancel,
  onSave,
  savingDisabled,
  children,
}: SectionProps) => {
  const [open, setOpen] = useState(initiallyOpen);
  // Editing forces open so Save/Cancel stay visible.
  const isOpen = editing ? true : open;
  return (
    <section
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--bg-subtle)',
          borderBottom: isOpen ? '1px solid var(--border)' : 'none',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          disabled={editing}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: editing ? 'default' : 'pointer',
            color: 'var(--text-subtle)',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Icon
            name="chevron"
            size={10}
            style={{ transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          />
        </button>
        <h2
          className="uppercase"
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-subtle)',
            letterSpacing: '0.06em',
            fontWeight: 600,
            margin: 0,
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
            {subtitle}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {editable && !editing && (
          <Button size="sm" variant="ghost" icon="edit" onClick={onEditToggle}>
            Edit
          </Button>
        )}
        {editing && (
          <>
            <Button
              size="sm"
              variant="primary"
              icon="check"
              disabled={savingDisabled}
              onClick={() => onSave?.()}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" icon="close" onClick={onCancel}>
              Cancel
            </Button>
          </>
        )}
      </header>
      {isOpen && (
        <div style={{ padding: 12 }}>
          {children}
        </div>
      )}
    </section>
  );
};

// ──────────────── Description ────────────────

const DescriptionSection = ({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => Promise<void>;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(draft); setEditing(false); }
    finally { setSaving(false); }
  };

  return (
    <Section
      title="Description"
      editable
      editing={editing}
      onEditToggle={() => setEditing(true)}
      onCancel={() => { setDraft(value); setEditing(false); }}
      onSave={handleSave}
      savingDisabled={saving}
    >
      {editing ? (
        <textarea
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ ...fieldStyle, width: '100%', height: 'auto', padding: '6px 8px', fontFamily: 'inherit' }}
        />
      ) : value ? (
        <p style={{ margin: 0, color: 'var(--text)', fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>
          {value}
        </p>
      ) : (
        <MutedText>No description.</MutedText>
      )}
    </Section>
  );
};

// ──────────────── Constraints (validation fields) ────────────────

const ConstraintsSection = ({
  attribute,
  onSave,
}: {
  attribute: Attribute;
  onSave: (validation: AttributeValidation | undefined) => Promise<void>;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AttributeValidation>(attribute.validation || {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(attribute.validation || {});
  }, [attribute.validation, editing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Drop empty keys.
      const cleaned: AttributeValidation = {};
      for (const [k, v] of Object.entries(draft)) {
        if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
        (cleaned as any)[k] = v;
      }
      await onSave(Object.keys(cleaned).length > 0 ? cleaned : undefined);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const validation = attribute.validation || {};
  const hasAny = Object.values(validation).some(v =>
    v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0));

  return (
    <Section
      title="Constraints"
      subtitle="attribute.validation — storage-level bounds, not rules"
      editable
      editing={editing}
      onEditToggle={() => setEditing(true)}
      onCancel={() => { setDraft(attribute.validation || {}); setEditing(false); }}
      onSave={handleSave}
      savingDisabled={saving}
    >
      {editing ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <NumberField label="minLength"  value={draft.minLength}  onChange={(minLength)  => setDraft({ ...draft, minLength })} />
          <NumberField label="maxLength"  value={draft.maxLength}  onChange={(maxLength)  => setDraft({ ...draft, maxLength })} />
          <NumberField label="minimum"    value={draft.minimum}    onChange={(minimum)    => setDraft({ ...draft, minimum })} />
          <NumberField label="maximum"    value={draft.maximum}    onChange={(maximum)    => setDraft({ ...draft, maximum })} />
          <NumberField label="precision"  value={draft.precision}  onChange={(precision)  => setDraft({ ...draft, precision })} />
          <NumberField label="scale"      value={draft.scale}      onChange={(scale)      => setDraft({ ...draft, scale })} />
          <FieldCol label="pattern" style={{ gridColumn: '1 / -1' }}>
            <input
              type="text"
              value={draft.pattern || ''}
              onChange={(e) => setDraft({ ...draft, pattern: e.target.value || undefined })}
              style={fieldStyleMono}
            />
          </FieldCol>
          <FieldCol label="format">
            <input
              type="text"
              value={draft.format || ''}
              onChange={(e) => setDraft({ ...draft, format: e.target.value || undefined })}
              style={fieldStyleMono}
            />
          </FieldCol>
          <FieldCol label="enum (comma-separated)" style={{ gridColumn: '1 / -1' }}>
            <input
              type="text"
              value={(draft.enumValues || []).join(', ')}
              onChange={(e) => setDraft({
                ...draft,
                enumValues: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
              })}
              style={fieldStyleMono}
            />
          </FieldCol>
        </div>
      ) : !hasAny ? (
        <MutedText>No constraints.</MutedText>
      ) : (
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 12px', margin: 0 }}>
          {Object.entries(validation).map(([k, v]) => {
            if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return null;
            return (
              <div key={k} style={{ display: 'contents' }}>
                <dt className="mono" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{k}</dt>
                <dd className="mono" style={{ margin: 0, color: 'var(--text)', fontSize: 'var(--fs-sm)' }}>
                  {Array.isArray(v) ? v.join(', ') : String(v)}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </Section>
  );
};

// ──────────────── Governance (stereotype metadata) ────────────────

const GovernanceSection = ({
  attribute,
  columns,
  onSave,
}: {
  attribute: Attribute;
  columns: MetadataColumn[];
  onSave: (column: MetadataColumn, value: string | number | boolean) => Promise<void>;
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | number | boolean>>({});

  useEffect(() => {
    if (!editing) {
      const seed: Record<string, string | number | boolean> = {};
      for (const col of columns) {
        const v = getMetadataValue(attribute, col.name);
        if (v !== undefined) seed[col.name] = v;
      }
      setDraft(seed);
    }
  }, [attribute, columns, editing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save each changed column sequentially — matches existing semantics.
      for (const col of columns) {
        const current = getMetadataValue(attribute, col.name);
        const next = draft[col.name];
        if (next !== current) {
          await onSave(col, next ?? '');
        }
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (columns.length === 0) {
    return (
      <Section title="Governance">
        <MutedText>No governance metadata defined for attributes.</MutedText>
      </Section>
    );
  }

  return (
    <Section
      title="Governance"
      subtitle="stereotype-driven metadata"
      editable
      editing={editing}
      onEditToggle={() => setEditing(true)}
      onCancel={() => setEditing(false)}
      onSave={handleSave}
      savingDisabled={saving}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {columns.map((col) => {
          const v = editing ? draft[col.name] : getMetadataValue(attribute, col.name);
          return (
            <div key={col.name} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span
                className="uppercase"
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--meta-label)',
                  letterSpacing: '0.04em',
                  fontWeight: 600,
                }}
                title={col.description}
              >
                {col.label}
                <span className="mono" style={{ color: 'var(--text-subtle)', marginLeft: 6, fontWeight: 400 }}>
                  {col.stereotypeName}
                </span>
              </span>
              {editing ? (
                col.type === 'flag' || col.type === 'boolean' ? (
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)' }}>
                    <input
                      type="checkbox"
                      checked={!!v}
                      onChange={(e) => setDraft(d => ({ ...d, [col.name]: e.target.checked }))}
                    />
                    {v ? 'yes' : 'no'}
                  </label>
                ) : (
                  <input
                    type="text"
                    value={v === undefined || v === null ? '' : String(v)}
                    onChange={(e) => setDraft(d => ({ ...d, [col.name]: e.target.value }))}
                    style={fieldStyle}
                  />
                )
              ) : v === undefined || v === null || v === '' ? (
                <span style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-sm)' }}>—</span>
              ) : typeof v === 'boolean' ? (
                v ? <Chip tone="success" soft>yes</Chip> : <Chip tone="neutral">no</Chip>
              ) : (
                <span style={{ color: 'var(--text)', fontSize: 'var(--fs-sm)' }}>{String(v)}</span>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
};

// ──────────────── Physical (metadata with physical.* prefix) ────────────────

const PhysicalSection = ({
  attribute,
  existingKeys,
  onSave,
}: {
  attribute: Attribute;
  existingKeys: string[];
  onSave: (patch: Record<string, string>) => Promise<void>;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) {
      const seed: Record<string, string> = {};
      for (const k of existingKeys) {
        const v = getMetadataValue(attribute, k);
        if (v !== undefined) seed[k] = String(v);
      }
      setDraft(seed);
    }
  }, [attribute, existingKeys, editing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const entries = (attribute.metadata || []).filter(m => m.name.startsWith('physical.'));

  return (
    <Section
      title="Physical"
      subtitle="metadata.physical.*"
      editable
      editing={editing}
      onEditToggle={() => setEditing(true)}
      onCancel={() => setEditing(false)}
      onSave={handleSave}
      savingDisabled={saving}
    >
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {existingKeys.length === 0 ? (
            <MutedText>No physical metadata. Close this section to add fields via the attribute form editor.</MutedText>
          ) : (
            existingKeys.map(k => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 8, alignItems: 'center' }}>
                <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{k}</span>
                <input
                  type="text"
                  value={draft[k] || ''}
                  onChange={(e) => setDraft(d => ({ ...d, [k]: e.target.value }))}
                  style={fieldStyleMono}
                />
              </div>
            ))
          )}
        </div>
      ) : entries.length === 0 ? (
        <MutedText>No physical metadata.</MutedText>
      ) : (
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 12px', margin: 0 }}>
          {entries.map((m) => (
            <div key={m.name} style={{ display: 'contents' }}>
              <dt className="mono" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{m.name}</dt>
              <dd className="mono" style={{ margin: 0, color: 'var(--text)', fontSize: 'var(--fs-sm)' }}>
                {String(m.value ?? '')}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  );
};

// ──────────────── Lineage (attribute-level — derived from entity lineage) ────────────────

const LineageSection = ({ attribute, entity }: { attribute: Attribute; entity: Entity }) => (
  <Section title="Lineage" initiallyOpen={false}>
    <MutedText>
      Attribute-level lineage isn't tracked separately — jump to{' '}
      <Link
        to={`/packages/${(entity as any)._service ?? ''}/entities/${entity.name}`}
        style={{ color: 'var(--accent)' }}
      >
        the entity's Lineage tab
      </Link>{' '}
      for upstream / downstream references involving <span className="mono">{attribute.name}</span>.
    </MutedText>
  </Section>
);

// ──────────────── Used by (relationships + rules) ────────────────

const UsedBySection = ({
  service,
  entity,
  rels,
  rules,
}: {
  service?: string;
  entity: Entity;
  rels: Relationship[];
  rules: Rule[];
}) => {
  const total = rels.length + rules.length;
  return (
    <Section title={`Used by (${total})`}>
      {total === 0 ? (
        <MutedText>Not referenced by any relationship or rule.</MutedText>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rels.length > 0 && (
            <div>
              <Subheader>Relationships</Subheader>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {rels.map((r) => (
                  <li key={r.uuid} style={{ fontSize: 'var(--fs-sm)' }}>
                    <Link
                      to={`/packages/${service}/entities/${entity.name}/relationships/${r.uuid}`}
                      style={{ color: 'var(--accent)' }}
                    >
                      {r.source.name || r.source.entity} → {r.target.name || r.target.entity}
                    </Link>
                    {r.description && (
                      <span style={{ color: 'var(--text-subtle)', marginLeft: 6 }}>({r.description})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rules.length > 0 && (
            <div>
              <Subheader>Rules</Subheader>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {rules.map((r) => (
                  <li key={r.uuid} style={{ fontSize: 'var(--fs-sm)' }}>
                    <Link to="/rules" style={{ color: 'var(--accent)' }} className="mono">
                      {r.name}
                    </Link>
                    <Chip tone={severityTone(r.severity)} soft className="mono" >
                      {r.severity}
                    </Chip>
                    {r.description && (
                      <span style={{ color: 'var(--text-subtle)', marginLeft: 6 }}>
                        {r.description.split('\n')[0].slice(0, 120)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
};

const severityTone = (s: Rule['severity']): 'danger' | 'warning' | 'info' =>
  s === 'error' ? 'danger' : s === 'warning' ? 'warning' : 'info';

// ──────────────── Activity ────────────────

const ActivitySection = ({ entity }: { entity: Entity }) => (
  <Section title="Activity" initiallyOpen={false}>
    <MutedText>
      Last updated{' '}
      <span className="mono">
        {entity.updatedAt
          ? new Date(entity.updatedAt).toLocaleString()
          : '—'}
      </span>
      . Per-attribute change history lives in the git log for the entity file.
    </MutedText>
  </Section>
);

// ──────────────── Shared tiny pieces ────────────────

const MutedText = ({ children }: { children: ReactNode }) => (
  <p style={{ margin: 0, color: 'var(--text-subtle)', fontSize: 'var(--fs-sm)' }}>{children}</p>
);

const Subheader = ({ children }: { children: ReactNode }) => (
  <div
    className="uppercase"
    style={{
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-subtle)',
      letterSpacing: '0.04em',
      fontWeight: 600,
    }}
  >
    {children}
  </div>
);

const FieldCol = ({ label, style, children }: { label: string; style?: React.CSSProperties; children: ReactNode }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{label}</span>
    {children}
  </label>
);

const NumberField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) => (
  <FieldCol label={label}>
    <input
      type="number"
      value={value ?? ''}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === '' ? undefined : Number(v));
      }}
      style={fieldStyleMono}
    />
  </FieldCol>
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

// Keep AttributeType imported to avoid no-unused-vars if future edits drop it.
void AttributeType;

export default AttributeDetailPage;
