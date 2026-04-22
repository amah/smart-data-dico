/**
 * Integrity page (#85 R5 / rollout 4.3).
 *
 * Single pane of glass that aggregates everything constraining or
 * validating the data into one searchable view, behind 4 tabs:
 *
 *   - **All**         — flat unified table with a Category column
 *   - **Validation**  — `attribute.validation` rows from every entity
 *   - **Constraints** — `entity.constraints[]` (physical, DB-enforced)
 *   - **Rules**       — first-class functional Rule objects
 *
 * The three concepts are kept strictly separate at the storage layer
 * (CLAUDE.md). This page is the only place that displays them together.
 *
 * Phase 4.3 redesign — chrome swap onto Toolbar + DataTable +
 * CategoryKindChip / StatusChip. The Status column is a forward-compat
 * slot: the backend doesn't publish per-item run status yet, so every
 * row starts at `pass`. The "Needs attention" preset filters pass rows
 * out, so the page is ready the moment status starts flowing.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { integrityApi } from '../services/api';
import type { PhysicalConstraint, Rule, RuleSeverityValue } from '../types';
import {
  Button,
  CategoryKindChip,
  Chip,
  DataTable,
  Icon,
  Input,
  StatusChip,
  Toolbar,
} from '../components/ui';
import type { ColumnDef, StatusValue } from '../components/ui';

type Tab = 'all' | 'validation' | 'constraints' | 'rules';
type IntegrityStatus = 'pass' | 'fail' | 'drift';
type IntegrityKind = 'validation' | 'constraint' | 'rule';

interface ValidationRow {
  service: string;
  entityUuid: string;
  entityName: string;
  attributeUuid: string;
  attributeName: string;
  kind: string;
  value: number | string | string[];
}

interface ConstraintRow {
  service: string;
  entityUuid: string;
  entityName: string;
  constraint: PhysicalConstraint;
}

/** Normalized row shape fed into DataTable. */
interface IntegrityRow {
  key: string;
  category: IntegrityKind;
  service: string;
  entityName: string;
  subject: string;       // attribute name, constraint name, or rule name
  kind: string;          // validation kind / constraint kind / rule tag
  severity: RuleSeverityValue;
  status: IntegrityStatus;
  detail: string;
  violationCount: number; // forward-compat: # rows violating; 0 for now
  href: string;
  payload: ValidationRow | ConstraintRow | Rule;
}

const SEVERITY_RANK: Record<RuleSeverityValue, number> = { error: 3, warning: 2, info: 1 };

// Validation kinds default to 'info'; patterns / format are a bit stronger.
function severityOfValidation(kind: string): RuleSeverityValue {
  if (kind === 'pattern' || kind === 'format') return 'warning';
  return 'info';
}

function severityOfConstraint(kind: string): RuleSeverityValue {
  if (kind === 'foreignKey' || kind === 'unique') return 'warning';
  if (kind === 'check') return 'warning';
  return 'info';
}

const formatValidationValue = (v: number | string | string[]) =>
  Array.isArray(v) ? v.join(', ') : String(v);

const formatConstraintDetail = (c: PhysicalConstraint) => {
  const parts: string[] = [];
  if (c.columns && c.columns.length > 0) parts.push(`(${c.columns.join(', ')})`);
  if (c.expression) parts.push(c.expression);
  if (c.references) parts.push(`→ ${c.references.table}(${(c.references.columns || []).join(', ')})`);
  return parts.join(' ');
};

function toRow(
  payload: ValidationRow | ConstraintRow | Rule,
  category: IntegrityKind,
): IntegrityRow {
  if (category === 'validation') {
    const v = payload as ValidationRow;
    return {
      key: `v-${v.entityUuid}-${v.attributeUuid}-${v.kind}`,
      category,
      service: v.service,
      entityName: v.entityName,
      subject: v.attributeName,
      kind: v.kind,
      severity: severityOfValidation(v.kind),
      status: 'pass',
      detail: formatValidationValue(v.value),
      violationCount: 0,
      href: `/packages/${v.service}/entities/${v.entityName}`,
      payload,
    };
  }
  if (category === 'constraint') {
    const c = payload as ConstraintRow;
    return {
      key: `c-${c.entityUuid}-${c.constraint.name || c.constraint.kind}-${(c.constraint.columns || []).join(',')}`,
      category,
      service: c.service,
      entityName: c.entityName,
      subject: c.constraint.name || '(unnamed)',
      kind: c.constraint.kind,
      severity: severityOfConstraint(c.constraint.kind),
      status: 'pass',
      detail: formatConstraintDetail(c.constraint),
      violationCount: 0,
      href: `/packages/${c.service}/entities/${c.entityName}`,
      payload,
    };
  }
  const r = payload as Rule;
  return {
    key: `r-${r.uuid}`,
    category,
    service: r.packageName || '—',
    entityName: r.entityUuid ? '(entity)' : `[${r.packageName || 'package'}]`,
    subject: r.name,
    kind: r.enforcement,
    severity: r.severity,
    status: 'pass',
    detail: (r.description || '').split('\n')[0].slice(0, 140),
    violationCount: 0,
    href: '/rules',
    payload,
  };
}

/** Status chip — drift is amber (warning) and first-class. */
function statusToValue(s: IntegrityStatus): StatusValue {
  return s; // 'pass' | 'fail' | 'drift' — directly supported by StatusChip
}

/** Severity chip — maps RuleSeverityValue onto the StatusChip grammar. */
function severityToValue(s: RuleSeverityValue): StatusValue {
  if (s === 'error') return 'error';
  if (s === 'warning') return 'warning';
  return 'info';
}

const IntegrityPage = () => {
  const navigate = useNavigate();
  const [validation, setValidation] = useState<ValidationRow[]>([]);
  const [constraints, setConstraints] = useState<ConstraintRow[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | RuleSeverityValue>('all');
  // "Needs attention" is an optional preset rather than the default on-state.
  // The handoff calls it out as a preset, not as the mandatory default, and
  // defaulting it off keeps the page useful before the backend publishes
  // per-rule run status.
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await integrityApi.getReport();
      setValidation(data.validation as ValidationRow[]);
      setConstraints(data.constraints as ConstraintRow[]);
      setRules(data.rules);
    } catch {
      setError('Failed to load the Integrity report. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const allRows = useMemo<IntegrityRow[]>(() => {
    return [
      ...validation.map(v => toRow(v, 'validation')),
      ...constraints.map(c => toRow(c, 'constraint')),
      ...rules.map(r => toRow(r, 'rule')),
    ];
  }, [validation, constraints, rules]);

  const tabRows = useMemo(() => {
    if (tab === 'validation') return allRows.filter(r => r.category === 'validation');
    if (tab === 'constraints') return allRows.filter(r => r.category === 'constraint');
    if (tab === 'rules') return allRows.filter(r => r.category === 'rule');
    return allRows;
  }, [allRows, tab]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tabRows.filter(r => {
      if (severityFilter !== 'all' && r.severity !== severityFilter) return false;
      // "Needs attention" keeps failures/drifts plus anything at severity=error.
      // With no run-status backend yet, everything starts at `pass`, so only
      // errors survive the preset — that matches the spec's intent of hiding
      // noise that's already green.
      if (needsAttentionOnly && r.status === 'pass' && r.severity !== 'error') {
        return false;
      }
      if (!needle) return true;
      return (
        r.service.toLowerCase().includes(needle) ||
        r.entityName.toLowerCase().includes(needle) ||
        r.subject.toLowerCase().includes(needle) ||
        r.kind.toLowerCase().includes(needle) ||
        r.detail.toLowerCase().includes(needle)
      );
    });
  }, [tabRows, search, severityFilter, needsAttentionOnly]);

  // Tab counts reflect the active search + severity filter so the
  // per-category totals update as the user narrows. "Needs attention"
  // does not fold into the counts (it's a view preset, not a filter
  // over the category roster).
  const counts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const keep = (r: IntegrityRow) => {
      if (severityFilter !== 'all' && r.severity !== severityFilter) return false;
      if (!needle) return true;
      return (
        r.service.toLowerCase().includes(needle) ||
        r.entityName.toLowerCase().includes(needle) ||
        r.subject.toLowerCase().includes(needle) ||
        r.kind.toLowerCase().includes(needle) ||
        r.detail.toLowerCase().includes(needle)
      );
    };
    const rows = allRows.filter(keep);
    return {
      all: rows.length,
      validation: rows.filter(r => r.category === 'validation').length,
      constraints: rows.filter(r => r.category === 'constraint').length,
      rules: rows.filter(r => r.category === 'rule').length,
    };
  }, [allRows, search, severityFilter]);

  const passingCount = useMemo(
    () => tabRows.filter(r => r.status === 'pass' && r.severity !== 'error').length,
    [tabRows],
  );

  // ──────────────── Columns ────────────────

  const columns = useMemo<ColumnDef<IntegrityRow>[]>(() => {
    const showCategory = tab === 'all';
    const std: ColumnDef<IntegrityRow>[] = [];

    if (showCategory) {
      std.push({
        key: 'category',
        header: 'Cat.',
        group: 'standard',
        sortable: true,
        width: 70,
        align: 'center',
        accessor: (r) => r.category,
        render: (r) => <CategoryKindChip kind={r.category} initialOnly />,
      });
    }

    std.push(
      {
        key: 'service',
        header: 'Service',
        group: 'standard',
        mono: true,
        sortable: true,
        filterable: true,
        width: 140,
        accessor: (r) => r.service,
      },
      {
        key: 'entity',
        header: 'Entity',
        group: 'standard',
        sortable: true,
        filterable: true,
        width: 140,
        accessor: (r) => r.entityName,
        render: (r) => (
          <Link
            to={r.href}
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'var(--accent)', fontWeight: 500 }}
          >
            {r.entityName}
          </Link>
        ),
      },
      {
        key: 'subject',
        header: 'Name / Attribute',
        group: 'standard',
        mono: true,
        sortable: true,
        filterable: true,
        width: 'minmax(160px, 1.2fr)',
        accessor: (r) => r.subject,
      },
      {
        key: 'kind',
        header: 'Kind',
        group: 'standard',
        mono: true,
        sortable: true,
        width: 120,
        accessor: (r) => r.kind,
        render: (r) => <Chip tone="neutral" mono>{r.kind}</Chip>,
      },
      {
        key: 'severity',
        header: 'Severity',
        group: 'standard',
        sortable: true,
        width: 110,
        accessor: (r) => SEVERITY_RANK[r.severity],
        render: (r) => <StatusChip value={severityToValue(r.severity)} />,
      },
      {
        key: 'status',
        header: 'Status',
        group: 'standard',
        sortable: true,
        width: 110,
        accessor: (r) => r.status,
        render: (r) => (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <StatusChip value={statusToValue(r.status)} />
            {r.violationCount > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); navigate(r.href); }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  fontSize: 'var(--fs-xs)',
                  fontFamily: 'var(--font-mono)',
                }}
                title="Open data preview"
              >
                {r.violationCount} rows violate
              </button>
            )}
          </span>
        ),
      },
      {
        key: 'detail',
        header: 'Detail',
        group: 'standard',
        filterable: true,
        width: 'minmax(220px, 1.6fr)',
        accessor: (r) => r.detail,
        render: (r) => r.detail
          ? <span style={{ color: 'var(--text-muted)' }}>{r.detail}</span>
          : <span style={{ color: 'var(--text-subtle)' }}>—</span>,
      },
    );

    return std;
  }, [tab, navigate]);

  // ──────────────── Render ────────────────

  return (
    <div className="flex flex-col gap-3" style={{ padding: 12 }}>
      {/* Header strip */}
      <div>
        <h1
          className="mono"
          style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600, margin: 0 }}
        >
          Integrity
        </h1>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
          Everything that must be true of your data — attribute validation, physical
          database constraints, and functional business rules. Three concepts, three
          homes (<code className="mono">CLAUDE.md</code>), one pane of glass.
        </p>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--danger-soft)',
            color: 'var(--danger)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon name="warning" size={14} /> {error}
        </div>
      )}

      {/* Summary tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 8,
        }}
      >
        <SummaryTile
          label="Total items"
          value={counts.all}
          icon="shield"
        />
        <SummaryTile
          label="Validation"
          value={counts.validation}
          tone="info"
        />
        <SummaryTile
          label="Constraints"
          value={counts.constraints}
          tone="warning"
        />
        <SummaryTile
          label="Rules"
          value={counts.rules}
          tone="accent"
        />
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: 2,
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          width: 'fit-content',
          gap: 2,
        }}
      >
        {(['all', 'validation', 'constraints', 'rules'] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t)}
              style={{
                padding: '4px 10px',
                fontSize: 'var(--fs-sm)',
                fontFamily: 'inherit',
                background: active ? 'var(--bg-raised)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--text-muted)',
                border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                fontWeight: active ? 600 : 400,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              <span
                className="mono"
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: active ? 'var(--text-muted)' : 'var(--text-subtle)',
                }}
              >
                {counts[t]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <Toolbar attached>
        <Input
          icon="search"
          size="sm"
          placeholder="Search by entity, attribute, name…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          width={320}
        />
        <SeverityFilter value={severityFilter} onChange={setSeverityFilter} />
        <Button
          size="md"
          variant={needsAttentionOnly ? 'soft' : 'ghost'}
          icon={needsAttentionOnly ? 'eye' : 'eyeOff'}
          pressed={needsAttentionOnly}
          onClick={() => setNeedsAttentionOnly(v => !v)}
        >
          Needs attention
        </Button>
        <Toolbar.Spacer />
        {loading && (
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>Loading…</span>
        )}
      </Toolbar>

      {/* Summary strip for collapsed passing rules */}
      {needsAttentionOnly && passingCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 12px',
            background: 'var(--success-soft)',
            border: '1px solid var(--success)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--success)',
          }}
        >
          <Icon name="check" size={14} />
          <span>{passingCount} passing item{passingCount === 1 ? '' : 's'} collapsed.</span>
          <button
            type="button"
            onClick={() => setNeedsAttentionOnly(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--success)',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: 'var(--fs-sm)',
              padding: 0,
            }}
          >
            Show all
          </button>
        </div>
      )}

      <DataTable<IntegrityRow>
        columns={columns}
        rows={filteredRows}
        getRowKey={(r) => r.key}
        onRowClick={(r) => navigate(r.href)}
        showFilterRow
        attached
        emptyMessage={
          search
            ? 'No items match your search.'
            : needsAttentionOnly
              ? 'Nothing needs attention — everything is passing.'
              : 'No items in this category.'
        }
      />
    </div>
  );
};

// ──────────────── Helpers ────────────────

const SeverityFilter = ({
  value,
  onChange,
}: {
  value: 'all' | RuleSeverityValue;
  onChange: (v: 'all' | RuleSeverityValue) => void;
}) => (
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
      onChange={(e) => onChange(e.target.value as 'all' | RuleSeverityValue)}
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
      <option value="all">all severities</option>
      <option value="error">error</option>
      <option value="warning">warning</option>
      <option value="info">info</option>
    </select>
  </label>
);

interface SummaryTileProps {
  label: string;
  value: number;
  icon?: 'shield' | 'chart' | 'warning';
  tone?: 'accent' | 'info' | 'warning' | 'success';
}

const SummaryTile = ({ label, value, icon, tone }: SummaryTileProps): JSX.Element => {
  const color =
    tone === 'accent' ? 'var(--accent)' :
    tone === 'info'    ? 'var(--text-muted)' :
    tone === 'warning' ? 'var(--warning)' :
    tone === 'success' ? 'var(--success)' :
    'var(--text)';
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '10px 12px',
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
          letterSpacing: '0.04em',
          fontWeight: 600,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {icon && <Icon name={icon} size={11} />}
        {label}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 'var(--fs-2xl)',
          fontWeight: 600,
          color,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>
    </div>
  );
};

const renderOptional = (_: unknown): ReactNode => null;
void renderOptional;

export default IntegrityPage;
