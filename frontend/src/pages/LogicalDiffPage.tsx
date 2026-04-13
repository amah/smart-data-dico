import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { diffApi, versionApi, servicesApi } from '../services/api';

// ────────────────────────────────────────────────────────────────────────
// Types (mirrors backend LogicalDiff)
// ────────────────────────────────────────────────────────────────────────

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
  attributes: AttrDiff[];
  constraints: any[];
  changedFields?: string[];
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
  changedFields?: string[];
}

interface RuleDiff {
  status: DiffStatus;
  ruleUuid: string;
  ruleName: string;
  changedFields?: string[];
}

interface LogicalDiffSummary {
  packages: Record<string, number>;
  entities: Record<string, number>;
  attributes: Record<string, number>;
  relationships: Record<string, number>;
  rules: Record<string, number>;
}

// ────────────────────────────────────────────────────────────────────────
// Status badge component
// ────────────────────────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  added: 'badge-success',
  changed: 'badge-warning',
  removed: 'badge-error',
  moved: 'badge-info',
  unchanged: 'badge-ghost',
};

function DiffBadge({ status }: { status: DiffStatus }) {
  if (status === 'unchanged') return null;
  return <span className={`badge badge-xs ${statusColors[status] || 'badge-ghost'}`}>{status}</span>;
}

// ────────────────────────────────────────────────────────────────────────
// Page component
// ────────────────────────────────────────────────────────────────────────

export default function LogicalDiffPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [services, setServices] = useState<string[]>([]);
  const [commits, setCommits] = useState<any[]>([]);
  const [service, setService] = useState(searchParams.get('service') || '');
  const [leftRef, setLeftRef] = useState(searchParams.get('left') || '');
  const [rightRef, setRightRef] = useState(searchParams.get('right') || 'HEAD');
  const [diff, setDiff] = useState<LogicalDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<DiffStatus | 'all'>('all');

  // Load services and commits on mount
  useState(() => {
    servicesApi.getAllServices().then((data: any) => setServices(data.data || [])).catch(() => {});
    versionApi.getCommitHistory(50).then((data: any) => setCommits(data.data || [])).catch(() => {});
  });

  const runDiff = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    setError(null);
    try {
      const allServices = service === '__all__';
      // When the user picks "All services", snapshot sources drop the
      // `service` field so the backend loads every service at once.
      const left = allServices
        ? leftRef
          ? { type: 'git-ref' as const, ref: leftRef }
          : { type: 'all-services' as const }
        : leftRef
          ? { type: 'git-ref' as const, ref: leftRef, service }
          : { type: 'service' as const, name: service };
      const right = allServices
        ? rightRef && rightRef !== 'HEAD'
          ? { type: 'git-ref' as const, ref: rightRef }
          : { type: 'all-services' as const }
        : rightRef && rightRef !== 'HEAD'
          ? { type: 'git-ref' as const, ref: rightRef, service }
          : { type: 'service' as const, name: service };

      const result = await diffApi.logical(left, right);
      setDiff(result);
      // Auto-expand changed packages
      const exp = new Set<string>();
      for (const pkg of result.packages) {
        if (pkg.status !== 'unchanged') exp.add(pkg.packageName);
      }
      setExpanded(exp);
      setSearchParams({ service, left: leftRef, right: rightRef });
    } catch (e: any) {
      setError(e.message || 'Failed to compute diff');
    } finally {
      setLoading(false);
    }
  }, [service, leftRef, rightRef, setSearchParams]);

  const toggle = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const filteredPackages = useMemo(() => {
    if (!diff) return [];
    if (filter === 'all') return diff.packages.filter(p => p.status !== 'unchanged');
    return diff.packages.filter(p => p.status === filter);
  }, [diff, filter]);

  const totalChanges = diff
    ? diff.summary.entities.added + diff.summary.entities.changed + diff.summary.entities.removed + (diff.summary.entities.moved || 0)
    : 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Model Diff</h1>
        <p className="text-base-content/70 mt-1">Compare two versions of the model</p>
      </div>

      {/* Source selectors */}
      <div className="card bg-base-200 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Service</span></label>
            <select className="select select-sm select-bordered" value={service} onChange={e => setService(e.target.value)}>
              <option value="">Select...</option>
              <option value="__all__">All services (whole model)</option>
              {services.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Left (before)</span></label>
            <select className="select select-sm select-bordered" value={leftRef} onChange={e => setLeftRef(e.target.value)}>
              <option value="">Working copy</option>
              {commits.map((c: any) => (
                <option key={c.hash} value={c.hash}>{c.hash?.slice(0, 7)} — {c.message?.slice(0, 40)}</option>
              ))}
            </select>
          </div>
          <div className="form-control">
            <label className="label"><span className="label-text">Right (after)</span></label>
            <select className="select select-sm select-bordered" value={rightRef} onChange={e => setRightRef(e.target.value)}>
              <option value="HEAD">Working copy</option>
              {commits.map((c: any) => (
                <option key={c.hash} value={c.hash}>{c.hash?.slice(0, 7)} — {c.message?.slice(0, 40)}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-sm btn-primary" onClick={runDiff} disabled={!service || loading}>
            {loading ? <span className="loading loading-spinner loading-xs" /> : 'Compare'}
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error"><span>{error}</span></div>}

      {/* Results */}
      {diff && (
        <>
          {/* Summary */}
          <div className="stats stats-horizontal shadow w-full">
            <div className="stat">
              <div className="stat-title">Packages</div>
              <div className="stat-value text-lg">{diff.summary.packages.changed + diff.summary.packages.added + diff.summary.packages.removed}</div>
              <div className="stat-desc">changed</div>
            </div>
            <div className="stat">
              <div className="stat-title">Entities</div>
              <div className="stat-value text-lg">{totalChanges}</div>
              <div className="stat-desc">
                {diff.summary.entities.added > 0 && <span className="text-success mr-1">+{diff.summary.entities.added}</span>}
                {diff.summary.entities.changed > 0 && <span className="text-warning mr-1">~{diff.summary.entities.changed}</span>}
                {diff.summary.entities.removed > 0 && <span className="text-error mr-1">-{diff.summary.entities.removed}</span>}
                {(diff.summary.entities.moved || 0) > 0 && <span className="text-info">m{diff.summary.entities.moved}</span>}
              </div>
            </div>
            <div className="stat">
              <div className="stat-title">Attributes</div>
              <div className="stat-value text-lg">{diff.summary.attributes.added + diff.summary.attributes.changed + diff.summary.attributes.removed}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Relationships</div>
              <div className="stat-value text-lg">{diff.summary.relationships.added + diff.summary.relationships.changed + diff.summary.relationships.removed}</div>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Filter:</span>
            {(['all', 'added', 'changed', 'removed', 'moved'] as const).map(f => (
              <button
                key={f}
                className={`btn btn-xs ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Diff tree */}
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Element</th>
                  <th>Status</th>
                  <th>Changes</th>
                </tr>
              </thead>
              <tbody>
                {filteredPackages.length === 0 && (
                  <tr><td colSpan={3} className="text-center text-base-content/50 py-8">No changes found</td></tr>
                )}
                {filteredPackages.map(pkg => (
                  <PackageRow
                    key={pkg.packageName}
                    pkg={pkg}
                    expanded={expanded}
                    toggle={toggle}
                    filter={filter}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Tree row components
// ────────────────────────────────────────────────────────────────────────

function Chevron({ isExpanded, onClick }: { isExpanded: boolean; onClick: () => void }) {
  return (
    <button className="btn btn-ghost btn-xs px-0 min-h-0 h-5 w-5" onClick={onClick}>
      <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

function PackageRow({ pkg, expanded, toggle, filter }: {
  pkg: PackageDiff;
  expanded: Set<string>;
  toggle: (key: string) => void;
  filter: DiffStatus | 'all';
}) {
  const key = `pkg:${pkg.packageName}`;
  const isExpanded = expanded.has(key);
  const entities = filter === 'all'
    ? pkg.entities.filter(e => e.status !== 'unchanged')
    : pkg.entities.filter(e => e.status === filter);
  const hasChildren = entities.length > 0 || pkg.relationships.some(r => r.status !== 'unchanged') || pkg.rules.some(r => r.status !== 'unchanged');

  const changeSummary = [
    pkg.counts.entities.added && `+${pkg.counts.entities.added} entities`,
    pkg.counts.entities.changed && `~${pkg.counts.entities.changed} entities`,
    pkg.counts.entities.removed && `-${pkg.counts.entities.removed} entities`,
    pkg.counts.entities.moved && `${pkg.counts.entities.moved} moved`,
    pkg.counts.relationships.added + pkg.counts.relationships.changed + pkg.counts.relationships.removed > 0 &&
      `${pkg.counts.relationships.added + pkg.counts.relationships.changed + pkg.counts.relationships.removed} rels`,
    pkg.counts.rules.added + pkg.counts.rules.changed + pkg.counts.rules.removed > 0 &&
      `${pkg.counts.rules.added + pkg.counts.rules.changed + pkg.counts.rules.removed} rules`,
  ].filter(Boolean).join(', ');

  return (
    <>
      <tr className="hover font-semibold">
        <td>
          <div className="flex items-center gap-1">
            {hasChildren ? <Chevron isExpanded={isExpanded} onClick={() => toggle(key)} /> : <span className="w-5" />}
            <span className="text-base-content/60 mr-1">pkg</span>
            {pkg.packageName}
          </div>
        </td>
        <td><DiffBadge status={pkg.status as DiffStatus} /></td>
        <td className="text-sm text-base-content/60">{changeSummary}</td>
      </tr>
      {isExpanded && entities.map(entity => (
        <EntityRow key={entity.entityUuid} entity={entity} expanded={expanded} toggle={toggle} pkgKey={key} />
      ))}
      {isExpanded && pkg.relationships.filter(r => r.status !== 'unchanged').map(rel => (
        <tr key={rel.relationshipUuid} className="hover">
          <td><div className="flex items-center gap-1" style={{ paddingLeft: '2.5rem' }}><span className="text-base-content/40 text-xs">rel</span> {rel.relationshipUuid.slice(0, 8)}</div></td>
          <td><DiffBadge status={rel.status as DiffStatus} /></td>
          <td className="text-xs text-base-content/50">{rel.changedFields?.join(', ')}</td>
        </tr>
      ))}
      {isExpanded && pkg.rules.filter(r => r.status !== 'unchanged').map(rule => (
        <tr key={rule.ruleUuid} className="hover">
          <td><div className="flex items-center gap-1" style={{ paddingLeft: '2.5rem' }}><span className="text-base-content/40 text-xs">rule</span> {rule.ruleName}</div></td>
          <td><DiffBadge status={rule.status as DiffStatus} /></td>
          <td className="text-xs text-base-content/50">{rule.changedFields?.join(', ')}</td>
        </tr>
      ))}
    </>
  );
}

function EntityRow({ entity, expanded, toggle, pkgKey }: {
  entity: EntityDiff;
  expanded: Set<string>;
  toggle: (key: string) => void;
  pkgKey: string;
}) {
  const key = `${pkgKey}:${entity.entityUuid}`;
  const isExpanded = expanded.has(key);
  const attrs = entity.attributes.filter(a => a.status !== 'unchanged');
  const hasChildren = attrs.length > 0 || entity.constraints.some(c => c.status !== 'unchanged');

  return (
    <>
      <tr className="hover">
        <td>
          <div className="flex items-center gap-1" style={{ paddingLeft: '1.25rem' }}>
            {hasChildren ? <Chevron isExpanded={isExpanded} onClick={() => toggle(key)} /> : <span className="w-5" />}
            {entity.entityName}
            {entity.movedFrom && <span className="text-xs text-info ml-1">from {entity.movedFrom}</span>}
          </div>
        </td>
        <td><DiffBadge status={entity.status} /></td>
        <td className="text-xs text-base-content/50">
          {entity.changedFields?.join(', ')}
          {attrs.length > 0 && !entity.changedFields?.length && `${attrs.length} attr changes`}
        </td>
      </tr>
      {isExpanded && attrs.map(attr => (
        <tr key={attr.attributeUuid} className="hover">
          <td>
            <div className="flex items-center gap-1" style={{ paddingLeft: '3.75rem' }}>
              <span className="text-base-content/40 text-xs">attr</span>
              {attr.attributeName}
            </div>
          </td>
          <td><DiffBadge status={attr.status} /></td>
          <td className="text-xs text-base-content/50">
            {attr.changedFields?.map(f => {
              if (f === 'type' && attr.left && attr.right) return `type: ${attr.left.type} → ${attr.right.type}`;
              if (f === 'name' && attr.left && attr.right) return `name: ${attr.left.name} → ${attr.right.name}`;
              return f;
            }).join(', ')}
          </td>
        </tr>
      ))}
      {isExpanded && entity.constraints.filter(c => c.status !== 'unchanged').map(c => (
        <tr key={c.key} className="hover">
          <td><div className="flex items-center gap-1" style={{ paddingLeft: '3.75rem' }}><span className="text-base-content/40 text-xs">constraint</span> {c.key}</div></td>
          <td><DiffBadge status={c.status} /></td>
          <td></td>
        </tr>
      ))}
    </>
  );
}
