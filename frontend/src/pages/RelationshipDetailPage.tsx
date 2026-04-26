/**
 * Relationship Detail page — Phase 5.2.
 *
 * Route: /packages/:pkg/entities/:entity/relationships/:uuid
 *
 * Same single-column shell as AttributeDetailPage. Handoff README §11:
 *   - identity header shows a Source → Target visual with two entity
 *     blobs, a colored arrow, and a kind badge
 *   - sections: Semantics · Cascade · Opposite side · Physical ·
 *     Invariants · Cases · Usage · Activity
 *   - Invariants = rules that target this relationship's uuid, rendered
 *     in mono with a severity chip
 *   - Opposite side = one-click jump to the inverse relationship on
 *     the target entity (reverse-direction between the same pair)
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  relationshipApi,
  ruleApi,
  entityApi,
  caseApi,
} from '../services/api';
import {
  useStereotypeMetadata,
  getMetadataValue,
  setMetadataValue,
  type MetadataColumn,
} from '../hooks/useStereotypeMetadata';
import {
  Cardinality,
  Case,
  Relationship,
  RelationshipType,
  Rule,
} from '../types';
import {
  Button,
  Chip,
  Icon,
  PageHeader,
  RelationshipKindChip,
} from '../components/ui';
import Breadcrumbs from '../components/Breadcrumbs';

interface EntityLookupEntry {
  name: string;
  service: string;
  uuid: string;
  // Rules-for-entity uuid — needed for fetching invariants at source/target.
}

const RelationshipDetailPage = () => {
  const params = useParams<{ '*': string }>();
  const { service, entityName, uuid } = parseParams(params['*'] || '');

  const [rels, setRels] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityMap, setEntityMap] = useState<Record<string, EntityLookupEntry>>({});
  const [rules, setRules] = useState<Rule[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const { allColumns: metaColumns } = useStereotypeMetadata('relationship');

  const load = useCallback(async () => {
    if (!service) return;
    try {
      setLoading(true);
      const list = await relationshipApi.getPackageRelationships(service);
      setRels(list);
    } catch {
      setError('Failed to load relationships.');
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => { load(); }, [load]);

  // Load all packages once to build the entity lookup (needed for
  // source/target display and cross-service detection).
  useEffect(() => {
    let cancelled = false;
    entityApi.getAllPackages().then((pkgs) => {
      if (cancelled) return;
      const map: Record<string, EntityLookupEntry> = {};
      for (const pkg of pkgs) {
        for (const e of pkg.entities || []) {
          map[e.uuid] = { name: e.name, service: pkg.name, uuid: e.uuid };
        }
      }
      setEntityMap(map);
    }).catch(() => { /* best effort */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    caseApi.getAll().then(setCases).catch(() => setCases([]));
  }, []);

  const rel = useMemo<Relationship | null>(
    () => rels.find(r => r.uuid === uuid) ?? null,
    [rels, uuid],
  );

  // Pull rules for the source entity — then filter to those targeting this rel.
  useEffect(() => {
    if (!rel) return;
    ruleApi.getRulesForEntity(rel.source.entity)
      .then(setRules)
      .catch(() => setRules([]));
  }, [rel?.source.entity]);

  const saveRelationship = useCallback(async (updater: (r: Relationship) => Relationship) => {
    if (!service || !rel) return;
    const updated = updater(rel);
    await relationshipApi.updateRelationship(service, rel.uuid, updated);
    await load();
  }, [service, rel, load]);

  if (loading) {
    return (
      <div className="flex justify-center items-center" style={{ padding: 60 }}>
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  if (error || !rel) {
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
          {error ?? `Relationship ${uuid ?? ''} not found on ${service}.`}
        </div>
      </div>
    );
  }

  const fromInfo = entityMap[rel.source.entity];
  const toInfo = entityMap[rel.target.entity];
  const fromLabel = fromInfo?.name || rel.source.name || rel.source.entity;
  const toLabel = toInfo?.name || rel.target.name || rel.target.entity;
  const kind = kindOf(rel);

  const invariants = rules.filter(r =>
    r.targets?.some(t => t.kind === 'relationship' && t.uuid === rel.uuid),
  );

  // Opposite-side: another relationship with source/target swapped between
  // the same two entities.
  const oppositeRel = rels.find(r =>
    r.uuid !== rel.uuid &&
    r.source.entity === rel.target.entity &&
    r.target.entity === rel.source.entity,
  );

  // Cases referencing either endpoint (heuristic — nothing
  // points at a relationship by uuid in the current storage).
  const matchingCases = cases.filter(c =>
    (c.rootEntities || []).includes(rel.source.entity) ||
    (c.rootEntities || []).includes(rel.target.entity),
  );

  return (
    <div className="flex flex-col gap-3" style={{ padding: '5px 12px 12px' }}>
      <PageHeader
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: 'Home', path: '/' },
              { label: 'packages', path: '/packages' },
              { label: service ?? '', path: `/packages/${service}` },
              { label: entityName ?? '', path: `/packages/${service}/entities/${entityName}` },
              { label: `rel:${rel.uuid.slice(0, 8)}`, path: `/packages/${service}/entities/${entityName}/relationships/${rel.uuid}` },
            ]}
          />
        }
        meta={rel.type ? <Chip tone={rel.type === 'lineage' ? 'info' : 'meta'}>{rel.type}</Chip> : undefined}
        actions={
          <Link to={`/packages/${service}/entities/${entityName}/relationships/${rel.uuid}/edit`}>
            <Button size="sm" variant="secondary" icon="edit">Form editor</Button>
          </Link>
        }
      />

      {/* Identity visual: source → target */}
      <div
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          minHeight: 40,
        }}
      >
        <EntityBlob
          label={fromLabel}
          service={fromInfo?.service}
          currentService={service}
          href={fromInfo ? `/packages/${fromInfo.service}/entities/${fromInfo.name}` : undefined}
        />
        <Arrow
          cardinality={cardinalityPill(rel.source.cardinality, rel.target.cardinality)}
          kind={kind}
        />
        <EntityBlob
          label={toLabel}
          service={toInfo?.service}
          currentService={service}
          href={toInfo ? `/packages/${toInfo.service}/entities/${toInfo.name}` : undefined}
        />
      </div>

      {/* Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SemanticsSection
          rel={rel}
          onSave={(patch) => saveRelationship(r => ({ ...r, ...patch }))}
        />
        <CascadeSection
          rel={rel}
          onSave={(patch) => saveRelationship(r => ({
            ...r,
            metadata: Object.entries(patch).reduce(
              (acc, [k, v]) => setMetadataValue(acc, k, v),
              r.metadata,
            ),
          }))}
        />
        <OppositeSideSection
          opposite={oppositeRel}
          entityMap={entityMap}
          service={service}
          currentEntity={entityName}
        />
        <PhysicalSection rel={rel} />
        <InvariantsSection invariants={invariants} />
        <CasesSection cases={matchingCases} />
        <UsageSection
          rel={rel}
          fromInfo={fromInfo}
          toInfo={toInfo}
          service={service}
          currentEntity={entityName}
          columns={metaColumns}
        />
        <ActivitySection rel={rel} />
      </div>
    </div>
  );
};

function parseParams(path: string): { service?: string; entityName?: string; uuid?: string } {
  const segments = path.split('/').filter(Boolean);
  const entIdx = segments.indexOf('entities');
  const relIdx = segments.indexOf('relationships');
  return {
    service: entIdx > 0 ? segments.slice(0, entIdx).join('/') : undefined,
    entityName: entIdx >= 0 ? segments[entIdx + 1] : undefined,
    uuid: relIdx >= 0 ? segments[relIdx + 1] : undefined,
  };
}

function kindOf(rel: Relationship): 'embedded' | 'reference' | 'lineage' {
  if (rel.type === 'lineage') return 'lineage';
  const hasRefs =
    (rel.source.referenceAttributes?.length ?? 0) > 0 ||
    (rel.target.referenceAttributes?.length ?? 0) > 0;
  return hasRefs ? 'reference' : 'embedded';
}

function cardinalityPill(source: Cardinality, target: Cardinality): string {
  const s = source === Cardinality.ONE ? '1' : '*';
  const t = target === Cardinality.ONE ? '1' : '*';
  return `${s}..${t}`;
}

// ──────────────── Identity visual ────────────────

interface EntityBlobProps {
  label: string;
  service?: string;
  currentService?: string;
  href?: string;
}

const EntityBlob = ({ label, service, currentService, href }: EntityBlobProps) => {
  const xsvc = !!service && !!currentService && service !== currentService;
  const body = (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: '4px 10px',
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-md)',
        minWidth: 140,
        maxWidth: 240,
        cursor: href ? 'pointer' : undefined,
        transition: 'border-color var(--dur-fast)',
      }}
      onMouseEnter={(e) => { if (href) e.currentTarget.style.borderColor = 'var(--accent)'; }}
      onMouseLeave={(e) => { if (href) e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          className="mono"
          style={{
            fontSize: 'var(--fs-md)',
            fontWeight: 600,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        {xsvc && <Chip tone="info" dashed className="mono" title={`in ${service}`}>xsvc</Chip>}
      </div>
      {service && (
        <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
          {service}
        </span>
      )}
    </div>
  );
  return href ? <Link to={href} style={{ textDecoration: 'none' }}>{body}</Link> : body;
};

const Arrow = ({ cardinality, kind }: { cardinality: string; kind: 'embedded' | 'reference' | 'lineage' }) => {
  const color =
    kind === 'embedded' ? 'var(--accent)' :
    kind === 'lineage'  ? 'var(--text-muted)' :
                          'var(--text-muted)';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        minWidth: 100,
      }}
    >
      <Chip tone="neutral" mono>{cardinality}</Chip>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <div style={{ width: 28, height: 0, borderTop: `2px ${kind === 'reference' ? 'dashed' : 'solid'} ${color}` }} />
        <Icon name="chevronR" size={14} style={{ color }} />
      </div>
      {kind === 'lineage' ? (
        <Chip tone="info" soft>lineage</Chip>
      ) : (
        <RelationshipKindChip kind={kind} />
      )}
    </div>
  );
};

// ──────────────── Section shell (shared) ────────────────

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
          <Button size="sm" variant="ghost" icon="edit" onClick={onEditToggle}>Edit</Button>
        )}
        {editing && (
          <>
            <Button size="sm" variant="primary" icon="check" disabled={savingDisabled} onClick={() => onSave?.()}>
              Save
            </Button>
            <Button size="sm" variant="ghost" icon="close" onClick={onCancel}>Cancel</Button>
          </>
        )}
      </header>
      {isOpen && <div style={{ padding: 12 }}>{children}</div>}
    </section>
  );
};

// ──────────────── Semantics ────────────────

const SemanticsSection = ({
  rel,
  onSave,
}: {
  rel: Relationship;
  onSave: (patch: Partial<Relationship>) => Promise<void>;
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState(rel.description || '');
  const [type, setType] = useState<RelationshipType>(rel.type || 'structural');
  const [srcCard, setSrcCard] = useState<Cardinality>(rel.source.cardinality);
  const [tgtCard, setTgtCard] = useState<Cardinality>(rel.target.cardinality);

  useEffect(() => {
    if (!editing) {
      setDescription(rel.description || '');
      setType(rel.type || 'structural');
      setSrcCard(rel.source.cardinality);
      setTgtCard(rel.target.cardinality);
    }
  }, [rel, editing]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        description: description || undefined,
        type,
        source: { ...rel.source, cardinality: srcCard },
        target: { ...rel.target, cardinality: tgtCard },
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Semantics"
      subtitle="What the relationship means"
      editable
      editing={editing}
      onEditToggle={() => setEditing(true)}
      onCancel={() => setEditing(false)}
      onSave={save}
      savingDisabled={saving}
    >
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FieldCol label="Description">
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ ...fieldStyle, width: '100%', height: 'auto', padding: '6px 8px', fontFamily: 'inherit' }}
            />
          </FieldCol>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <FieldCol label="Type">
              <select value={type} onChange={(e) => setType(e.target.value as RelationshipType)} style={fieldStyleMono}>
                <option value="structural">structural</option>
                <option value="lineage">lineage</option>
              </select>
            </FieldCol>
            <FieldCol label="Source cardinality">
              <select value={srcCard} onChange={(e) => setSrcCard(e.target.value as Cardinality)} style={fieldStyleMono}>
                <option value={Cardinality.ONE}>one</option>
                <option value={Cardinality.MANY}>many</option>
              </select>
            </FieldCol>
            <FieldCol label="Target cardinality">
              <select value={tgtCard} onChange={(e) => setTgtCard(e.target.value as Cardinality)} style={fieldStyleMono}>
                <option value={Cardinality.ONE}>one</option>
                <option value={Cardinality.MANY}>many</option>
              </select>
            </FieldCol>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rel.description
            ? <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>{rel.description}</p>
            : <MutedText>No description.</MutedText>}
          <div style={{ display: 'flex', gap: 16, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            <span>type <span className="mono" style={{ color: 'var(--text)' }}>{rel.type || 'structural'}</span></span>
            <span>
              cardinality{' '}
              <Chip tone="neutral" mono>
                {cardinalityPill(rel.source.cardinality, rel.target.cardinality)}
              </Chip>
            </span>
          </div>
        </div>
      )}
    </Section>
  );
};

// ──────────────── Cascade (metadata) ────────────────

const CASCADE_KEYS = ['cascade', 'cdc', 'navigability'] as const;

const CascadeSection = ({
  rel,
  onSave,
}: {
  rel: Relationship;
  onSave: (patch: Record<string, string>) => Promise<void>;
}) => {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!editing) {
      const seed: Record<string, string> = {};
      for (const k of CASCADE_KEYS) {
        const v = getMetadataValue({ metadata: rel.metadata } as any, k);
        if (v !== undefined) seed[k] = String(v);
      }
      setDraft(seed);
    }
  }, [rel, editing]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Cascade"
      subtitle="metadata.cascade · cdc · navigability"
      editable
      editing={editing}
      onEditToggle={() => setEditing(true)}
      onCancel={() => setEditing(false)}
      onSave={save}
      savingDisabled={saving}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {CASCADE_KEYS.map(k => {
          const v = editing ? draft[k] : getMetadataValue({ metadata: rel.metadata } as any, k);
          return (
            <FieldCol key={k} label={k}>
              {editing ? (
                <input
                  type="text"
                  value={v === undefined ? '' : String(v)}
                  onChange={(e) => setDraft(d => ({ ...d, [k]: e.target.value }))}
                  style={fieldStyleMono}
                />
              ) : v === undefined || v === null || v === '' ? (
                <span style={{ color: 'var(--text-subtle)' }}>—</span>
              ) : (
                <span className="mono" style={{ color: 'var(--text)', fontSize: 'var(--fs-sm)' }}>{String(v)}</span>
              )}
            </FieldCol>
          );
        })}
      </div>
    </Section>
  );
};

// ──────────────── Opposite side ────────────────

const OppositeSideSection = ({
  opposite,
  entityMap,
  service,
  currentEntity,
}: {
  opposite?: Relationship;
  entityMap: Record<string, EntityLookupEntry>;
  service?: string;
  currentEntity?: string;
}) => (
  <Section title="Opposite side" subtitle="Inverse relationship between the same pair">
    {!opposite ? (
      <MutedText>No inverse relationship recorded.</MutedText>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          {entityMap[opposite.source.entity]?.name || opposite.source.entity}{' '}
          → {entityMap[opposite.target.entity]?.name || opposite.target.entity}
          {opposite.description && (
            <span style={{ color: 'var(--text-subtle)', marginLeft: 6 }}>({opposite.description})</span>
          )}
        </div>
        <Link
          to={`/packages/${service}/entities/${currentEntity}/relationships/${opposite.uuid}`}
          style={{ color: 'var(--accent)', fontSize: 'var(--fs-sm)', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <Icon name="chevronR" size={10} />
          Jump to inverse
        </Link>
      </div>
    )}
  </Section>
);

// ──────────────── Physical ────────────────

const PhysicalSection = ({ rel }: { rel: Relationship }) => {
  const entries = (rel.metadata || []).filter(m => m.name.startsWith('physical.'));
  return (
    <Section title="Physical" subtitle="metadata.physical.*">
      {entries.length === 0 ? (
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

// ──────────────── Invariants ────────────────

const InvariantsSection = ({ invariants }: { invariants: Rule[] }) => (
  <Section title={`Invariants (${invariants.length})`} subtitle="Rules enforcing domain truths">
    {invariants.length === 0 ? (
      <MutedText>No rules target this relationship.</MutedText>
    ) : (
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {invariants.map((r) => (
          <li key={r.uuid} style={{ fontSize: 'var(--fs-sm)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Chip tone={severityTone(r.severity)} soft className="mono">{r.severity}</Chip>
              <Link to="/rules" className="mono" style={{ color: 'var(--accent)', fontWeight: 500 }}>
                {r.name}
              </Link>
            </div>
            {r.description && (
              <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', paddingLeft: 4 }}>
                {r.description.split('\n')[0]}
              </span>
            )}
          </li>
        ))}
      </ul>
    )}
  </Section>
);

const severityTone = (s: Rule['severity']): 'danger' | 'warning' | 'info' =>
  s === 'error' ? 'danger' : s === 'warning' ? 'warning' : 'info';

// ──────────────── Cases ────────────────

const CasesSection = ({ cases }: { cases: Case[] }) => (
  <Section title={`Cases (${cases.length})`} initiallyOpen={false}>
    {cases.length === 0 ? (
      <MutedText>Not rooted by any case (heuristic — matches cases rooted at source or target).</MutedText>
    ) : (
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {cases.map((c) => (
          <li key={c.uuid} style={{ fontSize: 'var(--fs-sm)' }}>
            <Link to={`/cases/${c.uuid}`} style={{ color: 'var(--accent)' }}>{c.name}</Link>
            {c.description && <span style={{ color: 'var(--text-subtle)', marginLeft: 6 }}>{c.description}</span>}
          </li>
        ))}
      </ul>
    )}
  </Section>
);

// ──────────────── Usage (stereotype meta + references) ────────────────

const UsageSection = ({
  rel,
  fromInfo,
  toInfo,
  service,
  currentEntity,
  columns,
}: {
  rel: Relationship;
  fromInfo?: EntityLookupEntry;
  toInfo?: EntityLookupEntry;
  service?: string;
  currentEntity?: string;
  columns: MetadataColumn[];
}) => {
  const otherColumns = columns.filter(c =>
    !(['cascade', 'cdc', 'navigability'] as string[]).includes(c.name) &&
    !c.name.startsWith('physical.'),
  );
  return (
    <Section title="Usage" subtitle="Navigation + stereotype metadata">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <Subheader>Navigation roles</Subheader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, fontSize: 'var(--fs-sm)' }}>
            {(rel.source.name || rel.source.referenceAttributes?.length) ? (
              <span>
                From <span className="mono" style={{ fontWeight: 500 }}>{fromInfo?.name || rel.source.entity}</span>:{' '}
                <span className="mono" style={{ color: 'var(--text-muted)' }}>
                  {rel.source.name || '(no role)'}
                </span>
                {rel.source.referenceAttributes?.length ? (
                  <span className="mono" style={{ color: 'var(--text-subtle)', marginLeft: 6 }}>
                    via {rel.source.referenceAttributes.join(', ')}
                  </span>
                ) : null}
              </span>
            ) : (
              <MutedText>No source-side role.</MutedText>
            )}
            {(rel.target.name || rel.target.referenceAttributes?.length) ? (
              <span>
                To <span className="mono" style={{ fontWeight: 500 }}>{toInfo?.name || rel.target.entity}</span>:{' '}
                <span className="mono" style={{ color: 'var(--text-muted)' }}>
                  {rel.target.name || '(no role)'}
                </span>
                {rel.target.referenceAttributes?.length ? (
                  <span className="mono" style={{ color: 'var(--text-subtle)', marginLeft: 6 }}>
                    via {rel.target.referenceAttributes.join(', ')}
                  </span>
                ) : null}
              </span>
            ) : (
              <MutedText>No target-side role.</MutedText>
            )}
          </div>
        </div>

        {otherColumns.length > 0 && (
          <div>
            <Subheader>Other metadata</Subheader>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 8,
                marginTop: 4,
              }}
            >
              {otherColumns.map(col => {
                const v = getMetadataValue({ metadata: rel.metadata } as any, col.name);
                return (
                  <div key={col.name}>
                    <div
                      className="uppercase"
                      style={{ fontSize: 'var(--fs-xs)', color: 'var(--meta-label)', letterSpacing: '0.04em', fontWeight: 600 }}
                    >
                      {col.label}
                    </div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: v ? 'var(--text)' : 'var(--text-subtle)' }}>
                      {v === undefined || v === null || v === '' ? '—' : String(v)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <Link
            to={`/packages/${service}/entities/${currentEntity}/relationships/${rel.uuid}/edit`}
          >
            <Button size="sm" variant="ghost" icon="edit">Open form editor</Button>
          </Link>
        </div>
      </div>
    </Section>
  );
};

// ──────────────── Activity ────────────────

const ActivitySection = ({ rel }: { rel: Relationship }) => (
  <Section title="Activity" initiallyOpen={false}>
    <MutedText>
      Relationship <span className="mono">{rel.uuid}</span> — change history lives
      in the git log for the package's relationships.yaml file.
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

export default RelationshipDetailPage;
