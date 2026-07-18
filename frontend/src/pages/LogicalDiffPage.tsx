/**
 * Logical model diff — Phase 4.6 redesign.
 *
 * Grammar (Model Diff):
 *   - Default compare: Working copy vs Last published (HEAD).
 *   - Ref swap happens in the toolbar.
 *   - Changes are grouped by entity inside severity bands, ordered
 *     breaking → major → minor → info (collapsible).
 *   - Kind glyphs:
 *       +  add
 *       −  remove
 *       ~  modify
 *       ⇄  rename
 *       ↻  retype
 *       ◎  meta
 *   - Before/after rendered as aligned two-line diffs, not raw JSON.
 *
 * All backend data paths (diff.getLogical, data-dictionary.git.log,
 * servicesApi.getAllServices) are preserved verbatim.
 */

import { useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { servicesApi } from '../services/api';
import { useCommand } from '../kernel/useCommand';
import {
  Button,
  Chip,
  Icon,
  Input,
  StatusChip,
  Toolbar,
} from '../components/ui';
import type { StatusValue } from '../components/ui';
import type { LogicalDiffOperand } from '../plugins/data-dictionary/services/DiffService';

// ──────────────── Backend shapes ────────────────

type DiffStatus = 'added' | 'changed' | 'removed' | 'unchanged' | 'moved';

interface LogicalDiff {
  packages: PackageDiff[];
  summary: LogicalDiffSummary;
}

interface PackageDiff {
  status: DiffStatus;
  packageName: string;
  entities: EntityDiff[];
  relationships: RelDiff[];
  rules: RuleDiff[];
  counts: any;
}

interface EntityDiff {
  status: DiffStatus;
  entityUuid: string;
  entityName: string;
  movedFrom?: string;
  left?: any;
  right?: any;
  attributes: AttrDiff[];
  constraints: ConstraintDiff[];
  changedFields?: string[];
}

interface ConstraintDiff {
  status: 'added' | 'changed' | 'removed' | 'unchanged';
  key: string;
  left?: { kind?: string; name?: string; columns?: string[] };
  right?: { kind?: string; name?: string; columns?: string[] };
}

interface AttrDiff {
  status: DiffStatus;
  attributeUuid: string;
  attributeName: string;
  left?: any;
  right?: any;
  changedFields?: string[];
}

interface RelDiff {
  status: DiffStatus;
  relationshipUuid: string;
  left?: any;
  right?: any;
  changedFields?: string[];
}

interface RuleDiff {
  status: DiffStatus;
  ruleUuid: string;
  ruleName: string;
  left?: any;
  right?: any;
  changedFields?: string[];
}

interface LogicalDiffSummary {
  packages: Record<string, number>;
  entities: Record<string, number>;
  attributes: Record<string, number>;
  relationships: Record<string, number>;
  rules: Record<string, number>;
}

interface BranchRefs {
  current: string;
  local: string[];
  remote: string[];
}

interface RefSelectOption {
  value: string;
  label: string;
  group?: 'Local branches' | 'Remote branches' | 'Commits';
}

// ──────────────── Derived shapes (for rendering) ────────────────

type Severity = 'breaking' | 'major' | 'minor' | 'info';
type ChangeKind = 'add' | 'remove' | 'modify' | 'rename' | 'retype' | 'meta';

const SEVERITY_ORDER: Severity[] = ['breaking', 'major', 'minor', 'info'];
const SEVERITY_LABEL: Record<Severity, string> = {
  breaking: 'Breaking',
  major:    'Major',
  minor:    'Minor',
  info:     'Info',
};

const KIND_GLYPH: Record<ChangeKind, string> = {
  add:    '+',
  remove: '−',
  modify: '~',
  rename: '⇄',
  retype: '↻',
  meta:   '◎',
};

const KIND_LABEL: Record<ChangeKind, string> = {
  add: 'ADDED',
  remove: 'REMOVED',
  modify: 'MODIFIED',
  rename: 'RENAMED',
  retype: 'RETYPED',
  meta: 'METADATA MODIFIED',
};

const KIND_TONE: Record<ChangeKind, StatusValue> = {
  add:    'info',   // additive, not breaking
  remove: 'breaking',
  modify: 'minor',
  rename: 'major',
  retype: 'breaking',
  meta:   'info',
};

interface ChangeRow {
  key: string;
  kind: ChangeKind;
  severity: Severity;
  subject: string;    // attribute/entity/rule/rel display name
  scope: 'entity' | 'attribute' | 'constraint' | 'relationship' | 'rule' | 'package';
  entityName: string;
  packageName: string;
  before?: string;
  after?: string;
  fields?: string[];
}

const severityFromAttr = (attr: AttrDiff): { severity: Severity; kind: ChangeKind } => {
  if (attr.status === 'added')   return { severity: 'info',     kind: 'add' };
  if (attr.status === 'removed') return { severity: 'breaking', kind: 'remove' };
  const changed = new Set(attr.changedFields || []);
  if (changed.has('type'))       return { severity: 'breaking', kind: 'retype' };
  if (changed.has('name'))       return { severity: 'major',    kind: 'rename' };
  if (changed.has('required'))   return { severity: 'major',    kind: 'modify' };
  if (changed.has('metadata'))   return { severity: 'info',     kind: 'meta' };
  return { severity: 'minor', kind: 'modify' };
};

const severityFromEntity = (entity: EntityDiff): { severity: Severity; kind: ChangeKind } => {
  if (entity.status === 'added')   return { severity: 'major',    kind: 'add' };
  if (entity.status === 'removed') return { severity: 'breaking', kind: 'remove' };
  if (entity.status === 'moved')   return { severity: 'minor',    kind: 'modify' };
  const changed = new Set(entity.changedFields || []);
  if (changed.has('name'))         return { severity: 'major',    kind: 'rename' };
  return { severity: 'minor', kind: 'modify' };
};

const fmtFieldValue = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return 'Not set';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const fmtChangedFields = (side: any, fields?: string[]): string => {
  if (!side || !fields?.length) return '';
  return fields.map(field => `${field}: ${fmtFieldValue(side[field])}`).join(' · ');
};

const fmtAttrValue = (side: any, fields?: string[]): string => {
  if (!side) return '';
  const changed = fmtChangedFields(side, fields);
  if (changed) return changed;
  const parts: string[] = [];
  if (side.name) parts.push(side.name);
  if (side.type) parts.push(`: ${side.type}`);
  if (side.required === true) parts.push(' required');
  if (side.defaultValue !== undefined && side.defaultValue !== null) {
    parts.push(` = ${JSON.stringify(side.defaultValue)}`);
  }
  return parts.join('');
};

const fmtConstraintValue = (side: ConstraintDiff['left']): string => {
  if (!side) return '';
  const label = side.name || side.kind || 'constraint';
  return `${label}${side.columns?.length ? ` (${side.columns.join(', ')})` : ''}`;
};

const fmtEntityValue = (side: any, fields?: string[]): string => {
  if (!side) return '';
  const changed = fmtChangedFields(side, fields);
  if (changed) return changed;
  return [side.name, side.stereotype && `«${side.stereotype}»`, side.status].filter(Boolean).join(' · ');
};

const fmtRelationshipValue = (side: any, fields?: string[]): string => {
  if (!side) return '';
  const changed = fmtChangedFields(side, fields);
  if (changed) return changed;
  const endpoints = side.sourceEntityUuid && side.targetEntityUuid
    ? `${String(side.sourceEntityUuid).slice(0, 8)} → ${String(side.targetEntityUuid).slice(0, 8)}`
    : '';
  return [side.name, endpoints, side.type || side.cardinality].filter(Boolean).join(' · ') || side.uuid || '';
};

const fmtRuleValue = (side: any, fields?: string[]): string => {
  if (!side) return '';
  const changed = fmtChangedFields(side, fields);
  if (changed) return changed;
  return [side.name, side.status, side.expression || side.condition].filter(Boolean).join(' · ');
};

export function buildLogicalOperand(service: string, ref: string): LogicalDiffOperand {
  if (ref) return { type: 'git-ref', ref, ...(service === '__all__' ? {} : { service }) };
  return service === '__all__'
    ? { type: 'all-services' }
    : { type: 'service', name: service };
}

export function buildRefOptions(branches: BranchRefs, commits: any[]): RefSelectOption[] {
  const local = [...new Set(branches.local)].map((branch) => ({
    value: branch,
    label: branch === branches.current ? `${branch} (current)` : branch,
    group: 'Local branches' as const,
  }));
  const remote = [...new Set(branches.remote)].map((branch) => ({
    value: branch,
    label: branch.replace(/^remotes\//, ''),
    group: 'Remote branches' as const,
  }));
  const commitOptions = commits.map((commit: any) => ({
    value: commit.hash,
    label: `${(commit.hash || '').slice(0, 7)} — ${(commit.message || '').slice(0, 40)}`,
    group: 'Commits' as const,
  }));

  return [
    { value: 'HEAD', label: 'HEAD (last published)' },
    { value: '', label: 'Working copy' },
    ...local,
    ...remote,
    ...commitOptions,
  ];
}

export function buildChangeRows(diff: LogicalDiff): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (const pkg of diff.packages) {
    if (pkg.status === 'added' || pkg.status === 'removed') {
      rows.push({
        key: `p-${pkg.packageName}`,
        kind: pkg.status === 'added' ? 'add' : 'remove',
        severity: pkg.status === 'added' ? 'major' : 'breaking',
        subject: pkg.packageName,
        scope: 'package',
        entityName: '(package)',
        packageName: pkg.packageName,
        before: pkg.status === 'removed' ? pkg.packageName : undefined,
        after: pkg.status === 'added' ? pkg.packageName : undefined,
      });
    }
    for (const entity of pkg.entities) {
      if (entity.status !== 'unchanged') {
        const { severity, kind } = severityFromEntity(entity);
        rows.push({
          key: `e-${pkg.packageName}-${entity.entityUuid}`,
          kind,
          severity,
          subject: entity.entityName,
          scope: 'entity',
          entityName: entity.entityName,
          packageName: pkg.packageName,
          before: entity.status === 'moved'
            ? `${entity.movedFrom} / ${fmtEntityValue(entity.left, entity.changedFields)}`
            : fmtEntityValue(entity.left, entity.changedFields) || undefined,
          after: entity.status === 'moved'
            ? `${pkg.packageName} / ${fmtEntityValue(entity.right, entity.changedFields)}`
            : fmtEntityValue(entity.right, entity.changedFields) || undefined,
          fields: entity.changedFields,
        });
      }
      for (const attr of entity.attributes) {
        if (attr.status === 'unchanged') continue;
        const { severity, kind } = severityFromAttr(attr);
        rows.push({
          key: `a-${pkg.packageName}-${entity.entityUuid}-${attr.attributeUuid}`,
          kind,
          severity,
          subject: attr.attributeName,
          scope: 'attribute',
          entityName: entity.entityName,
          packageName: pkg.packageName,
          before: fmtAttrValue(attr.left, attr.changedFields),
          after: fmtAttrValue(attr.right, attr.changedFields),
          fields: attr.changedFields,
        });
      }
      for (const constraint of entity.constraints || []) {
        if (constraint.status === 'unchanged') continue;
        rows.push({
          key: `c-${pkg.packageName}-${entity.entityUuid}-${constraint.key}`,
          kind: constraint.status === 'added' ? 'add' : constraint.status === 'removed' ? 'remove' : 'modify',
          severity: constraint.status === 'removed' ? 'breaking' : constraint.status === 'changed' ? 'major' : 'info',
          subject: constraint.right?.name || constraint.left?.name || constraint.key,
          scope: 'constraint',
          entityName: entity.entityName,
          packageName: pkg.packageName,
          before: fmtConstraintValue(constraint.left),
          after: fmtConstraintValue(constraint.right),
          fields: ['constraint'],
        });
      }
    }
    for (const rel of pkg.relationships) {
      if (rel.status === 'unchanged') continue;
      rows.push({
        key: `r-${pkg.packageName}-${rel.relationshipUuid}`,
        kind: rel.status === 'added' ? 'add' : rel.status === 'removed' ? 'remove' : 'modify',
        severity: rel.status === 'removed' ? 'breaking' : rel.status === 'added' ? 'info' : 'minor',
        subject: rel.relationshipUuid.slice(0, 8),
        scope: 'relationship',
        entityName: '(package)',
        packageName: pkg.packageName,
        before: fmtRelationshipValue(rel.left, rel.changedFields) || undefined,
        after: fmtRelationshipValue(rel.right, rel.changedFields) || undefined,
        fields: rel.changedFields,
      });
    }
    for (const rule of pkg.rules) {
      if (rule.status === 'unchanged') continue;
      rows.push({
        key: `ru-${pkg.packageName}-${rule.ruleUuid}`,
        kind: rule.status === 'added' ? 'add' : rule.status === 'removed' ? 'remove' : 'modify',
        severity: rule.status === 'removed' ? 'major' : 'info',
        subject: rule.ruleName,
        scope: 'rule',
        entityName: '(package)',
        packageName: pkg.packageName,
        before: fmtRuleValue(rule.left, rule.changedFields) || undefined,
        after: fmtRuleValue(rule.right, rule.changedFields) || undefined,
        fields: rule.changedFields,
      });
    }
  }
  return rows;
}

// ──────────────── Component ────────────────

export default function LogicalDiffPage() {
  const run = useCommand();
  const [searchParams, setSearchParams] = useSearchParams();
  const [services, setServices] = useState<string[]>([]);
  const [commits, setCommits] = useState<any[]>([]);
  const [branches, setBranches] = useState<BranchRefs>({ current: '', local: [], remote: [] });
  const [service, setService] = useState(searchParams.get('service') || '');
  const [leftRef, setLeftRef] = useState(searchParams.get('left') ?? 'HEAD');
  const [rightRef, setRightRef] = useState(searchParams.get('right') ?? '');
  const [diff, setDiff] = useState<LogicalDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<Severity>>(() => new Set(['info']));
  const [filter, setFilter] = useState('');

  useEffect(() => {
    servicesApi.getAllServices().then((data: any) => setServices(data.data || [])).catch(() => {});
    run('data-dictionary.git.log', { limit: 50 }).then((data: any) => setCommits(data || [])).catch(() => {});
    run('data-dictionary.git.listBranches').then((data) => {
      const current = typeof data.current === 'object' ? data.current.name : data.current;
      setBranches({
        current: current || '',
        local: data.local || data.branches || data.all || [],
        remote: data.remote || [],
      });
    }).catch(() => {});
  }, []);

  const refOptions = useMemo(() => buildRefOptions(branches, commits), [branches, commits]);

  const runDiff = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    setError(null);
    try {
      const left = buildLogicalOperand(service, leftRef);
      const right = buildLogicalOperand(service, rightRef);

      const result = await run('data-dictionary.diff.getLogical', { left, right });
      // Service contract is intentionally opaque (`unknown`) — page narrows.
      setDiff(result as LogicalDiff);
      setSearchParams({ service, left: leftRef, right: rightRef });
    } catch (e: any) {
      setError(e.message || 'Failed to compute diff');
    } finally {
      setLoading(false);
    }
  }, [service, leftRef, rightRef, setSearchParams, run]);

  const allRows = useMemo<ChangeRow[]>(() => diff ? buildChangeRows(diff) : [], [diff]);

  const filteredRows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return allRows;
    return allRows.filter(r =>
      r.subject.toLowerCase().includes(needle) ||
      r.entityName.toLowerCase().includes(needle) ||
      r.packageName.toLowerCase().includes(needle),
    );
  }, [allRows, filter]);

  const bySeverity = useMemo(() => {
    const m: Record<Severity, ChangeRow[]> = { breaking: [], major: [], minor: [], info: [] };
    for (const r of filteredRows) m[r.severity].push(r);
    return m;
  }, [filteredRows]);

  const totals = useMemo(() => ({
    breaking: bySeverity.breaking.length,
    major:    bySeverity.major.length,
    minor:    bySeverity.minor.length,
    info:     bySeverity.info.length,
    total:    filteredRows.length,
  }), [bySeverity, filteredRows]);

  const toggleSeverity = (s: Severity) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const swapRefs = () => {
    setLeftRef(rightRef);
    setRightRef(leftRef);
  };

  return (
    <div className="flex flex-col gap-3" style={{ padding: 12 }}>
      {/* Header */}
      <div>
        <h1
          className="mono"
          style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600, margin: 0 }}
        >
          Model diff
        </h1>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
          Compare two versions of the logical model. Default compare is HEAD
          (before) vs working copy (after) — pick any git ref, branch, or SHA.
        </p>
      </div>

      {/* Ref selector toolbar */}
      <Toolbar>
        <FieldSelect label="Service" value={service} onChange={setService} options={[
          { value: '', label: 'Select…' },
          { value: '__all__', label: 'All services (whole model)' },
          ...services.map(s => ({ value: s, label: s })),
        ]} width={200} />

        <FieldSelect
          label="Left (before)"
          value={leftRef}
          onChange={setLeftRef}
          options={refOptions}
          width={260}
          mono
        />
        <Button
          size="sm"
          variant="ghost"
          icon="sort"
          onClick={swapRefs}
          title="Swap left / right"
          iconOnly
          aria-label="swap"
        />
        <FieldSelect
          label="Right (after)"
          value={rightRef}
          onChange={setRightRef}
          options={refOptions}
          width={260}
          mono
        />
        <Toolbar.Spacer />
        <Button
          size="md"
          variant="primary"
          icon="branch"
          onClick={runDiff}
          disabled={!service || loading}
        >
          {loading ? 'Comparing…' : 'Compare'}
        </Button>
      </Toolbar>

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

      {diff && (
        <>
          {/* Summary tiles */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
            }}
          >
            {SEVERITY_ORDER.map((s) => (
              <SummaryTile key={s} severity={s} count={totals[s]} />
            ))}
          </div>

          {/* Filter strip */}
          <Toolbar attached>
            <Input
              icon="search"
              size="sm"
              placeholder="Filter by entity / attribute / package…"
              value={filter}
              onChange={(e) => setFilter(e.currentTarget.value)}
              width={340}
            />
            <Toolbar.Spacer />
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
              {totals.total} change{totals.total === 1 ? '' : 's'}
            </span>
          </Toolbar>

          {/* Severity bands */}
          {totals.total === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {SEVERITY_ORDER.map((sev) => {
                const rows = bySeverity[sev];
                if (rows.length === 0) return null;
                const isCollapsed = collapsed.has(sev);
                return (
                  <SeverityBand
                    key={sev}
                    severity={sev}
                    rows={rows}
                    collapsed={isCollapsed}
                    onToggle={() => toggleSeverity(sev)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ──────────────── Pieces ────────────────

interface FieldSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: RefSelectOption[];
  width?: number;
  mono?: boolean;
}

const FieldSelect = ({ label, value, onChange, options, width = 200, mono }: FieldSelectProps) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>{label}</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 28,
        width,
        padding: '0 6px',
        fontSize: 'var(--fs-sm)',
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        background: 'var(--bg-raised)',
        color: 'var(--text)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-sm)',
      }}
    >
      {options.filter(o => !o.group).map(o => (
        <option key={o.value || 'working-copy'} value={o.value}>{o.label}</option>
      ))}
      {(['Local branches', 'Remote branches', 'Commits'] as const).map(group => {
        const grouped = options.filter(o => o.group === group);
        return grouped.length > 0 ? (
          <optgroup key={group} label={group}>
            {grouped.map(o => <option key={`${group}-${o.value}`} value={o.value}>{o.label}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
  </label>
);

const SummaryTile = ({ severity, count }: { severity: Severity; count: number }) => {
  const emptyTone = count === 0 ? 'var(--text-subtle)' : undefined;
  const toneColor =
    severity === 'breaking' ? 'var(--danger)' :
    severity === 'major'    ? 'var(--warning)' :
    severity === 'minor'    ? 'var(--text-muted)' :
                              'var(--text-muted)';
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
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        {SEVERITY_LABEL[severity]}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 'var(--fs-2xl)',
          fontWeight: 600,
          color: emptyTone || toneColor,
          letterSpacing: '-0.02em',
        }}
      >
        {count}
      </div>
    </div>
  );
};

const EmptyState = () => (
  <div
    style={{
      padding: 24,
      textAlign: 'center',
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderTop: 0,
      borderRadius: '0 0 var(--radius-md) var(--radius-md)',
      color: 'var(--text-subtle)',
      fontSize: 'var(--fs-sm)',
    }}
  >
    No changes between these refs.
  </div>
);

interface SeverityBandProps {
  severity: Severity;
  rows: ChangeRow[];
  collapsed: boolean;
  onToggle: () => void;
}

const SeverityBand = ({ severity, rows, collapsed, onToggle }: SeverityBandProps) => {
  // Group by packageName → entityName for entity-scoped rendering.
  const groups = useMemo(() => {
    const m = new Map<string, { packageName: string; entityName: string; rows: ChangeRow[] }>();
    for (const r of rows) {
      const key = `${r.packageName}/${r.entityName}`;
      if (!m.has(key)) m.set(key, { packageName: r.packageName, entityName: r.entityName, rows: [] });
      m.get(key)!.rows.push(r);
    }
    return [...m.values()].sort((a, b) => a.entityName.localeCompare(b.entityName));
  }, [rows]);

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
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--bg-subtle)',
          borderBottom: collapsed ? 'none' : '1px solid var(--border)',
          cursor: 'pointer',
        }}
      >
        <Icon
          name="chevron"
          size={10}
          style={{
            color: 'var(--text-subtle)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform var(--dur-fast)',
          }}
        />
        <StatusChip value={severity === 'info' ? 'info' : severity as StatusValue} />
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          {rows.length} {SEVERITY_LABEL[severity].toLowerCase()} change{rows.length === 1 ? '' : 's'}
        </span>
        <div style={{ flex: 1 }} />
        <span
          className="mono"
          style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}
        >
          {groups.length} entit{groups.length === 1 ? 'y' : 'ies'}
        </span>
      </header>

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {groups.map((g) => (
            <EntityGroup key={`${g.packageName}/${g.entityName}`} group={g} />
          ))}
        </div>
      )}
    </section>
  );
};

const EntityGroup = ({ group }: { group: { packageName: string; entityName: string; rows: ChangeRow[] } }) => (
  <div style={{ borderTop: '1px solid var(--border)' }}>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        background: 'var(--bg-subtle)',
      }}
    >
      <span
        className="mono"
        style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}
      >
        {group.packageName}
      </span>
      <Icon name="chevronR" size={10} style={{ color: 'var(--text-subtle)' }} />
      <span className="mono" style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>
        {group.entityName}
      </span>
    </div>
    <div>
      {group.rows.map((r) => (
        <ChangeRowView key={r.key} row={r} />
      ))}
    </div>
  </div>
);

const ChangeRowView = ({ row }: { row: ChangeRow }) => {
  const toneColor =
    row.kind === 'remove' || row.kind === 'retype' ? 'var(--danger)' :
    row.kind === 'rename' || row.kind === 'modify' ? 'var(--warning)' :
    row.kind === 'add'                             ? 'var(--success)' :
                                                     'var(--text-muted)';
  const showDiff = row.before !== undefined || row.after !== undefined;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '28px 1fr',
        gap: 8,
        padding: '6px 12px',
        borderBottom: '1px solid var(--border)',
        alignItems: 'start',
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 'var(--fs-lg)',
          lineHeight: 1,
          color: toneColor,
          textAlign: 'center',
          paddingTop: 2,
        }}
        title={row.kind}
      >
        {KIND_GLYPH[row.kind]}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Chip tone={KIND_TONE[row.kind] === 'breaking' ? 'danger' : KIND_TONE[row.kind] === 'major' ? 'warning' : 'info'}>
            {KIND_LABEL[row.kind]}
          </Chip>
          <span
            className="mono"
            style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', fontWeight: 500 }}
          >
            {row.subject}
          </span>
          <span
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}
          >
            {row.scope}
          </span>
          {row.fields && row.fields.length > 0 && (
            <span
              className="mono"
              style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}
            >
              {row.fields.join(', ')}
            </span>
          )}
        </div>
        {showDiff && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 24px minmax(0, 1fr)',
              gap: 6,
              alignItems: 'stretch',
              fontSize: 'var(--fs-xs)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <DiffSide label="Before" value={row.before} tone="before" />
            <span aria-hidden="true" style={{ alignSelf: 'center', textAlign: 'center', color: 'var(--text-subtle)' }}>→</span>
            <DiffSide label="After" value={row.after} tone="after" />
          </div>
        )}
      </div>
    </div>
  );
};

const DiffSide = ({ label, value, tone }: { label: string; value?: string; tone: 'before' | 'after' }) => {
  const missing = !value;
  const color = missing ? 'var(--text-subtle)' : tone === 'before' ? 'var(--danger)' : 'var(--success)';
  const background = missing
    ? 'var(--bg-subtle)'
    : tone === 'before' ? 'var(--danger-soft)' : 'var(--success-soft)';

  return (
    <div
      style={{
        minWidth: 0,
        padding: '5px 7px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${missing ? 'var(--border)' : color}`,
        background,
      }}
    >
      <div style={{ fontFamily: 'inherit', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-subtle)', marginBottom: 2 }}>
        {label}
      </div>
      <div
        title={value || 'Not present'}
        style={{ color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: missing ? 'italic' : 'normal' }}
      >
        {value || 'Not present'}
      </div>
    </div>
  );
};

// Keep ReactNode/Button referenced to satisfy no-unused-vars if future edits
// remove their only usages.
void (null as unknown as ReactNode);
