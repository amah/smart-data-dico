/**
 * Integrity page (#85 R5).
 *
 * Single pane of glass that aggregates everything that constrains or
 * validates the data into one searchable view, behind 4 tabs:
 *
 *   - **All**         — flat unified table with a Category column
 *   - **Validation**  — `attribute.validation` rows from every entity
 *   - **Constraints** — `entity.constraints[]` (physical, DB-enforced)
 *   - **Rules**       — first-class functional Rule objects
 *
 * The three concepts are kept strictly separate at the storage layer
 * (see CLAUDE.md). This page is the only place that displays them
 * together. The page name is "Integrity" rather than "Governance"
 * because governance implies decision bodies; this page is about the
 * rules themselves — the things that must be true of the data.
 *
 * One backend round-trip via `GET /api/integrity` populates all four
 * tabs. The frontend derives per-tab counts and filtering in useMemo
 * so switching tabs is instant.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { integrityApi } from '../services/api';
import type { Rule, PhysicalConstraint, RuleSeverityValue, RuleEnforcement } from '../types';

type Tab = 'all' | 'validation' | 'constraints' | 'rules';

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

const severityBadgeClass = (s: RuleSeverityValue) =>
  s === 'error' ? 'badge-error' : s === 'warning' ? 'badge-warning' : 'badge-info';

const enforcementBadgeClass = (e: RuleEnforcement) =>
  e === 'save' ? 'badge-error' : e === 'process' ? 'badge-warning' : 'badge-ghost';

const constraintKindBadgeClass = (k: string) =>
  k === 'unique'
    ? 'badge-primary'
    : k === 'foreignKey'
      ? 'badge-secondary'
      : k === 'check'
        ? 'badge-warning'
        : 'badge-ghost';

const validationKindBadgeClass = (kind: string) => {
  if (kind === 'pattern' || kind === 'format' || kind === 'enumValues') return 'badge-info';
  if (kind === 'minimum' || kind === 'maximum' || kind === 'precision' || kind === 'scale') return 'badge-success';
  return 'badge-ghost'; // length kinds
};

const formatValidationValue = (v: number | string | string[]) =>
  Array.isArray(v) ? v.join(', ') : String(v);

const formatConstraintDetail = (c: PhysicalConstraint) => {
  const parts: string[] = [];
  if (c.columns && c.columns.length > 0) parts.push(`(${c.columns.join(', ')})`);
  if (c.expression) parts.push(c.expression);
  if (c.references) parts.push(`→ ${c.references.table}(${(c.references.columns || []).join(', ')})`);
  return parts.join(' ');
};

const IntegrityPage = () => {
  const [validation, setValidation] = useState<ValidationRow[]>([]);
  const [constraints, setConstraints] = useState<ConstraintRow[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<'category' | 'entity'>('category');

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

  // ─── Search filter (applied to all three lists) ─────────────────────
  const matches = (haystack: string) => {
    if (!search) return true;
    return haystack.toLowerCase().includes(search.toLowerCase());
  };

  const filteredValidation = useMemo(
    () =>
      validation.filter(v =>
        matches(`${v.service} ${v.entityName} ${v.attributeName} ${v.kind} ${formatValidationValue(v.value)}`),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [validation, search],
  );

  const filteredConstraints = useMemo(
    () =>
      constraints.filter(c =>
        matches(
          `${c.service} ${c.entityName} ${c.constraint.kind} ${c.constraint.name || ''} ${formatConstraintDetail(c.constraint)}`,
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [constraints, search],
  );

  const filteredRules = useMemo(
    () =>
      rules.filter(r =>
        matches(`${r.name} ${r.description} ${(r.tags || []).join(' ')}`),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rules, search],
  );

  // ─── Tab counts (always derived from full filtered lists) ───────────
  const counts = {
    all: filteredValidation.length + filteredConstraints.length + filteredRules.length,
    validation: filteredValidation.length,
    constraints: filteredConstraints.length,
    rules: filteredRules.length,
  };

  // ─── Entity-first grouping (when groupBy === 'entity') ─────────────
  type EntityGroup = {
    key: string;
    service: string;
    entityName: string;
    validation: ValidationRow[];
    constraints: ConstraintRow[];
    rules: Rule[];
  };
  const entityGroups = useMemo<EntityGroup[]>(() => {
    const groups = new Map<string, EntityGroup>();
    const ensure = (key: string, service: string, entityName: string) => {
      if (!groups.has(key)) {
        groups.set(key, { key, service, entityName, validation: [], constraints: [], rules: [] });
      }
      return groups.get(key)!;
    };
    for (const v of filteredValidation) {
      ensure(`${v.service}::${v.entityUuid}`, v.service, v.entityName).validation.push(v);
    }
    for (const c of filteredConstraints) {
      ensure(`${c.service}::${c.entityUuid}`, c.service, c.entityName).constraints.push(c);
    }
    // Rules don't always have an entity context — group by package as a stand-in.
    for (const r of filteredRules) {
      const key = r.entityUuid
        ? `${r.packageName || '?'}::${r.entityUuid}`
        : `${r.packageName || '?'}::pkg`;
      const name = r.entityUuid ? '(entity)' : `[${r.packageName || 'unknown'}]`;
      ensure(key, r.packageName || 'unknown', name).rules.push(r);
    }
    return Array.from(groups.values()).sort((a, b) =>
      `${a.service}.${a.entityName}`.localeCompare(`${b.service}.${b.entityName}`),
    );
  }, [filteredValidation, filteredConstraints, filteredRules]);

  // ─── Render helpers ─────────────────────────────────────────────────
  const renderValidationRow = (v: ValidationRow) => (
    <tr key={`v-${v.entityUuid}-${v.attributeUuid}-${v.kind}`} className="hover">
      {tab === 'all' && (
        <td>
          <span className="badge badge-xs badge-info">validation</span>
        </td>
      )}
      <td className="text-xs text-base-content/60">{v.service}</td>
      <td>
        <Link
          to={`/packages/${v.service}/entities/${v.entityName}`}
          className="link link-hover font-medium"
        >
          {v.entityName}
        </Link>
      </td>
      <td className="font-mono text-sm">{v.attributeName}</td>
      <td>
        <span className={`badge badge-xs ${validationKindBadgeClass(v.kind)}`}>{v.kind}</span>
      </td>
      <td className="font-mono text-xs break-all">{formatValidationValue(v.value)}</td>
    </tr>
  );

  const renderConstraintRow = (c: ConstraintRow) => (
    <tr key={`c-${c.entityUuid}-${c.constraint.name || c.constraint.kind}-${(c.constraint.columns || []).join(',')}`} className="hover">
      {tab === 'all' && (
        <td>
          <span className="badge badge-xs badge-warning">constraint</span>
        </td>
      )}
      <td className="text-xs text-base-content/60">{c.service}</td>
      <td>
        <Link
          to={`/packages/${c.service}/entities/${c.entityName}`}
          className="link link-hover font-medium"
        >
          {c.entityName}
        </Link>
      </td>
      <td className="font-mono text-sm">{c.constraint.name || <span className="text-base-content/40">(unnamed)</span>}</td>
      <td>
        <span className={`badge badge-xs ${constraintKindBadgeClass(c.constraint.kind)}`}>
          {c.constraint.kind}
        </span>
      </td>
      <td className="font-mono text-xs break-all">{formatConstraintDetail(c.constraint)}</td>
    </tr>
  );

  const renderRuleRow = (r: Rule) => (
    <tr key={`r-${r.uuid}`} className="hover cursor-pointer">
      {tab === 'all' && (
        <td>
          <span className="badge badge-xs badge-success">rule</span>
        </td>
      )}
      <td className="text-xs text-base-content/60">{r.packageName || '—'}</td>
      <td>
        <Link to="/rules" className="link link-hover font-medium">
          {r.name}
        </Link>
      </td>
      <td>
        <span className={`badge badge-xs ${severityBadgeClass(r.severity)}`}>{r.severity}</span>
      </td>
      <td>
        <span className={`badge badge-xs ${enforcementBadgeClass(r.enforcement)}`}>
          {r.enforcement}
        </span>
      </td>
      <td className="text-xs">{r.description.split('\n')[0].slice(0, 100)}</td>
    </tr>
  );

  // ─── Page body ──────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Integrity</h1>
        <p className="text-base-content/70 text-sm">
          Everything that must be true of your data — attribute validation, physical
          database constraints, and functional business rules. Three concepts, three
          homes (see <code>CLAUDE.md</code>), one pane of glass.
        </p>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs tabs-boxed">
        <button
          className={`tab ${tab === 'all' ? 'tab-active' : ''}`}
          onClick={() => setTab('all')}
        >
          All <span className="badge badge-xs badge-ghost ml-2">{counts.all}</span>
        </button>
        <button
          className={`tab ${tab === 'validation' ? 'tab-active' : ''}`}
          onClick={() => setTab('validation')}
        >
          Validation <span className="badge badge-xs badge-info ml-2">{counts.validation}</span>
        </button>
        <button
          className={`tab ${tab === 'constraints' ? 'tab-active' : ''}`}
          onClick={() => setTab('constraints')}
        >
          Constraints <span className="badge badge-xs badge-warning ml-2">{counts.constraints}</span>
        </button>
        <button
          className={`tab ${tab === 'rules' ? 'tab-active' : ''}`}
          onClick={() => setTab('rules')}
        >
          Rules <span className="badge badge-xs badge-success ml-2">{counts.rules}</span>
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex gap-2 items-center flex-wrap">
        <input
          type="text"
          placeholder="Search by entity, attribute, name, expression…"
          className="input input-bordered input-sm flex-1 max-w-md"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex items-center gap-1 text-xs">
          <span className="text-base-content/60">Group by:</span>
          <select
            className="select select-bordered select-xs"
            value={groupBy}
            onChange={e => setGroupBy(e.target.value as 'category' | 'entity')}
          >
            <option value="category">Category (default)</option>
            <option value="entity">Entity</option>
          </select>
        </div>
      </div>

      {loading && <div className="text-center text-base-content/60 py-4">Loading…</div>}

      {/* ─── Category-first layout ─── */}
      {!loading && groupBy === 'category' && (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                {tab === 'all' && <th>Category</th>}
                <th>Service</th>
                <th>Entity</th>
                {tab === 'validation' && <th>Attribute</th>}
                {tab === 'validation' && <th>Kind</th>}
                {tab === 'validation' && <th>Value</th>}
                {tab === 'constraints' && <th>Name</th>}
                {tab === 'constraints' && <th>Kind</th>}
                {tab === 'constraints' && <th>Detail</th>}
                {tab === 'rules' && <th>Name</th>}
                {tab === 'rules' && <th>Severity</th>}
                {tab === 'rules' && <th>Enforcement</th>}
                {tab === 'rules' && <th>Description</th>}
                {tab === 'all' && <th>Name / Attribute</th>}
                {tab === 'all' && <th>Kind / Severity</th>}
                {tab === 'all' && <th>Detail</th>}
              </tr>
            </thead>
            <tbody>
              {(tab === 'all' || tab === 'validation') &&
                filteredValidation.map(renderValidationRow)}
              {(tab === 'all' || tab === 'constraints') &&
                filteredConstraints.map(renderConstraintRow)}
              {(tab === 'all' || tab === 'rules') && filteredRules.map(renderRuleRow)}

              {counts[tab] === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-base-content/50 py-6">
                    {search ? 'No items match your search.' : 'No items in this category.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Entity-first layout ─── */}
      {!loading && groupBy === 'entity' && (
        <div className="space-y-3">
          {entityGroups.length === 0 && (
            <div className="text-center text-base-content/50 py-6">
              {search ? 'No entities match your search.' : 'No items to display.'}
            </div>
          )}
          {entityGroups.map(g => {
            const showVal = tab === 'all' || tab === 'validation';
            const showCon = tab === 'all' || tab === 'constraints';
            const showRul = tab === 'all' || tab === 'rules';
            const total =
              (showVal ? g.validation.length : 0) +
              (showCon ? g.constraints.length : 0) +
              (showRul ? g.rules.length : 0);
            if (total === 0) return null;
            return (
              <div key={g.key} className="card card-compact bg-base-200">
                <div className="card-body">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">
                      <span className="text-xs text-base-content/60">{g.service}</span> /{' '}
                      <span>{g.entityName}</span>
                    </h3>
                    <div className="flex gap-1">
                      {showVal && g.validation.length > 0 && (
                        <span className="badge badge-xs badge-info">{g.validation.length} val</span>
                      )}
                      {showCon && g.constraints.length > 0 && (
                        <span className="badge badge-xs badge-warning">
                          {g.constraints.length} con
                        </span>
                      )}
                      {showRul && g.rules.length > 0 && (
                        <span className="badge badge-xs badge-success">{g.rules.length} rul</span>
                      )}
                    </div>
                  </div>
                  <ul className="text-xs space-y-0.5 mt-1">
                    {showVal &&
                      g.validation.map(v => (
                        <li key={`gv-${v.attributeUuid}-${v.kind}`}>
                          <span className="badge badge-xs badge-info mr-1">val</span>
                          <span className="font-mono">
                            {v.attributeName}.{v.kind}
                          </span>{' '}
                          = {formatValidationValue(v.value)}
                        </li>
                      ))}
                    {showCon &&
                      g.constraints.map(c => (
                        <li key={`gc-${c.constraint.name || ''}-${(c.constraint.columns || []).join(',')}-${c.constraint.kind}`}>
                          <span className="badge badge-xs badge-warning mr-1">con</span>
                          <span className="font-mono">
                            {c.constraint.kind}
                            {c.constraint.name ? ` ${c.constraint.name}` : ''}
                          </span>{' '}
                          {formatConstraintDetail(c.constraint)}
                        </li>
                      ))}
                    {showRul &&
                      g.rules.map(r => (
                        <li key={`gr-${r.uuid}`}>
                          <span className="badge badge-xs badge-success mr-1">rul</span>
                          <span className="font-mono">{r.name}</span>{' '}
                          <span className={`badge badge-xs ${severityBadgeClass(r.severity)}`}>
                            {r.severity}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default IntegrityPage;
