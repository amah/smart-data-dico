import { useState, useCallback, useEffect } from 'react';
import { servicesApi, diffApi } from '../services/api';
import axios from 'axios';

const api = axios.create({ baseURL: '/api', headers: { 'Content-Type': 'application/json' } });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token') || 'mock-token-for-testing';
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

type AttrStatus = 'matched' | 'modelOnly' | 'orphaned' | 'dbOnly' | 'drifted';

interface PhysicalDiff {
  entities: EntityDiff[];
  summary: { matched: number; modelOnly: number; orphaned: number; dbOnly: number; drifted: number; entities: Record<string, number> };
}

interface EntityDiff {
  status: string;
  entityName: string;
  entityUuid?: string;
  physicalTableName: string;
  attributes: AttrDiff[];
  constraints: any[];
}

interface AttrDiff {
  status: AttrStatus;
  attributeName: string;
  attributeUuid?: string;
  physicalColumnName?: string;
  driftFields?: string[];
  model?: any;
  source?: any;
}

/**
 * Per-service source config used in "All services" mode. Each service
 * independently chooses a source type and, for live introspection, has
 * its own credential pair (never persisted).
 */
interface PerServiceSourceState {
  type: 'ddl' | 'live';
  sql?: string;
  user?: string;
  password?: string;
}

/**
 * Whole-model aggregated response shape from POST /api/diff/physical/all.
 * `byService` is one entry per requested service — either an `ok` diff or
 * a per-service `error` string.
 */
interface AllPhysicalDiff {
  byService: Record<string, { status: 'ok'; diff: PhysicalDiff } | { status: 'error'; error: string }>;
  summary: {
    services: number;
    ok: number;
    failed: number;
    matched: number;
    drifted: number;
    modelOnly: number;
    orphaned: number;
    dbOnly: number;
  };
}

const statusStyles: Record<string, { color: string; label: string; icon: string }> = {
  matched: { color: 'text-success', label: 'Matched', icon: '✓' },
  modelOnly: { color: 'text-info', label: 'Model only', icon: '🚧' },
  orphaned: { color: 'text-error', label: 'Orphaned', icon: '✗' },
  dbOnly: { color: 'text-warning', label: 'DB only', icon: '🆕' },
  drifted: { color: 'text-warning', label: 'Drifted', icon: '⚠' },
};

const ALL = '__all__';

export default function PhysicalDiffPage() {
  const [services, setServices] = useState<string[]>([]);
  const [service, setService] = useState('');
  // Single-service mode state
  const [sql, setSql] = useState('');
  const [diff, setDiff] = useState<PhysicalDiff | null>(null);
  // All-services mode state
  const [perService, setPerService] = useState<Record<string, PerServiceSourceState>>({});
  const [physicalConfigs, setPhysicalConfigs] = useState<Record<string, any>>({});
  const [allDiff, setAllDiff] = useState<AllPhysicalDiff | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    servicesApi.getAllServices().then((data: any) => setServices(data.data || [])).catch(() => {});
  }, []);

  // Whenever the user flips into all-services mode, seed per-service state
  // with `{ type: 'ddl' }` for every service and attempt to load each one's
  // persisted physical config. Services without a config can still use DDL
  // paste; services with one get 'live' as the default.
  useEffect(() => {
    if (service !== ALL || services.length === 0) return;
    const seed: Record<string, PerServiceSourceState> = {};
    const configs: Record<string, any> = {};
    Promise.all(
      services.map(async svc => {
        try {
          const cfg = await diffApi.getPhysicalConfig(svc);
          if (cfg) configs[svc] = cfg;
          seed[svc] = { type: cfg ? 'live' : 'ddl' };
        } catch {
          seed[svc] = { type: 'ddl' };
        }
      }),
    ).then(() => {
      setPhysicalConfigs(configs);
      setPerService(seed);
    });
  }, [service, services]);

  const runDiff = useCallback(async () => {
    if (service === ALL) {
      // All-services mode
      setLoading(true);
      setError(null);
      setAllDiff(null);
      try {
        const sources: Record<string, any> = {};
        for (const svc of services) {
          const s = perService[svc];
          if (!s) continue;
          if (s.type === 'ddl') {
            if (!s.sql?.trim()) continue; // skip services with no input
            sources[svc] = { type: 'ddl', sql: s.sql };
          } else {
            if (!s.user || !s.password) continue;
            sources[svc] = { type: 'live', credentials: { user: s.user, password: s.password } };
          }
        }
        if (Object.keys(sources).length === 0) {
          setError('Provide a source for at least one service.');
          setLoading(false);
          return;
        }
        const result = await diffApi.physicalAll(sources, Object.keys(sources));
        setAllDiff(result as AllPhysicalDiff);
        // Auto-expand every entity that has a drift in any ok result
        const exp = new Set<string>();
        for (const [svc, r] of Object.entries(result.byService) as [string, any][]) {
          if (r.status === 'ok') {
            for (const e of r.diff.entities) {
              if (e.attributes.some((a: AttrDiff) => a.status !== 'matched')) exp.add(`${svc}:${e.physicalTableName}`);
            }
          }
        }
        setExpanded(exp);
      } catch (e: any) {
        setError(e.response?.data?.message || e.message || 'Failed');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Single-service mode (unchanged legacy path)
    if (!service || !sql.trim()) return;
    setLoading(true);
    setError(null);
    setAllDiff(null);
    try {
      const response = await api.post('/diff/physical', {
        service,
        source: { type: 'ddl', sql },
      });
      setDiff(response.data.data);
      const exp = new Set<string>();
      for (const e of response.data.data.entities) {
        if (e.attributes.some((a: AttrDiff) => a.status !== 'matched')) exp.add(e.physicalTableName);
      }
      setExpanded(exp);
    } catch (e: any) {
      setError(e.response?.data?.message || e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  }, [service, sql, services, perService]);

  const toggle = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const updatePerService = (svc: string, patch: Partial<PerServiceSourceState>) => {
    setPerService(prev => ({ ...prev, [svc]: { ...(prev[svc] || { type: 'ddl' }), ...patch } }));
  };

  const isAllMode = service === ALL;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Physical Sync</h1>
        <p className="text-base-content/70 mt-1">
          Compare model physical metadata against a database schema — pick a single service or
          <strong> All services</strong> to diff the whole model at once.
        </p>
      </div>

      <div className="card bg-base-200 p-4 space-y-3">
        <div className="flex items-end gap-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Service</span></label>
            <select className="select select-sm select-bordered" value={service} onChange={e => setService(e.target.value)}>
              <option value="">Select...</option>
              <option value={ALL}>All services (whole model)</option>
              {services.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button
            className="btn btn-sm btn-primary"
            onClick={runDiff}
            disabled={
              loading ||
              (!isAllMode && (!service || !sql.trim())) ||
              (isAllMode && services.length === 0)
            }
          >
            {loading ? <span className="loading loading-spinner loading-xs" /> : 'Compare'}
          </button>
        </div>

        {!isAllMode && (
          <textarea
            className="textarea textarea-bordered w-full font-mono text-xs"
            rows={6}
            placeholder="Paste SQL DDL here (CREATE TABLE statements)..."
            value={sql}
            onChange={e => setSql(e.target.value)}
          />
        )}

        {isAllMode && (
          <div className="space-y-2">
            <div className="text-sm text-base-content/70">
              Configure each service's source. Live introspection uses the persisted physical
              config (dialect + host/database/schema) with runtime credentials — credentials are
              never saved on disk.
            </div>
            <div className="space-y-2">
              {services.map(svc => {
                const s = perService[svc] || { type: 'ddl' };
                const cfg = physicalConfigs[svc];
                return (
                  <div key={svc} className="border border-base-300 rounded p-3 bg-base-100 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{svc}</div>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="radio"
                            className="radio radio-xs"
                            checked={s.type === 'ddl'}
                            onChange={() => updatePerService(svc, { type: 'ddl' })}
                          />
                          DDL paste
                        </label>
                        <label className={`flex items-center gap-1 text-xs ${!cfg ? 'opacity-50' : ''}`}>
                          <input
                            type="radio"
                            className="radio radio-xs"
                            checked={s.type === 'live'}
                            disabled={!cfg}
                            onChange={() => updatePerService(svc, { type: 'live' })}
                          />
                          Live ({cfg ? `${cfg.dialect}` : 'no physical.yaml'})
                        </label>
                      </div>
                    </div>
                    {s.type === 'ddl' && (
                      <textarea
                        className="textarea textarea-bordered w-full font-mono text-xs"
                        rows={3}
                        placeholder={`CREATE TABLE… (DDL for ${svc}, or leave blank to skip)`}
                        value={s.sql || ''}
                        onChange={e => updatePerService(svc, { sql: e.target.value })}
                      />
                    )}
                    {s.type === 'live' && cfg && (
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="input input-xs input-bordered"
                          placeholder="User"
                          value={s.user || ''}
                          onChange={e => updatePerService(svc, { user: e.target.value })}
                        />
                        <input
                          className="input input-xs input-bordered"
                          placeholder="Password"
                          type="password"
                          value={s.password || ''}
                          onChange={e => updatePerService(svc, { password: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error"><span>{error}</span></div>}

      {/* ─── Single-service results ─── */}
      {diff && !isAllMode && (
        <>
          <div className="stats stats-horizontal shadow w-full">
            {(['matched', 'modelOnly', 'orphaned', 'dbOnly', 'drifted'] as const).map(key => (
              <div key={key} className="stat">
                <div className="stat-title">{statusStyles[key].label}</div>
                <div className={`stat-value text-lg ${statusStyles[key].color}`}>{diff.summary[key]}</div>
              </div>
            ))}
          </div>

          <DiffTable
            entities={diff.entities}
            expanded={expanded}
            onToggle={toggle}
            keyPrefix=""
          />
        </>
      )}

      {/* ─── All-services results ─── */}
      {allDiff && isAllMode && (
        <>
          <div className="stats stats-horizontal shadow w-full">
            <div className="stat">
              <div className="stat-title">Services</div>
              <div className="stat-value text-lg">{allDiff.summary.services}</div>
              <div className="stat-desc">
                <span className="text-success">{allDiff.summary.ok} ok</span>
                {allDiff.summary.failed > 0 && (
                  <span className="text-error ml-2">{allDiff.summary.failed} failed</span>
                )}
              </div>
            </div>
            {(['matched', 'drifted', 'modelOnly', 'orphaned', 'dbOnly'] as const).map(key => (
              <div key={key} className="stat">
                <div className="stat-title">{statusStyles[key].label}</div>
                <div className={`stat-value text-lg ${statusStyles[key].color}`}>
                  {allDiff.summary[key]}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {Object.entries(allDiff.byService).map(([svc, result]) => (
              <div key={svc} className="card bg-base-100 border border-base-300 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold">{svc}</h3>
                  {result.status === 'error' && (
                    <span className="badge badge-error">error</span>
                  )}
                  {result.status === 'ok' && (
                    <span className="badge badge-success">
                      {result.diff.summary.matched} matched · {result.diff.summary.drifted} drifted
                    </span>
                  )}
                </div>
                {result.status === 'error' && (
                  <div className="text-sm text-error font-mono">{result.error}</div>
                )}
                {result.status === 'ok' && (
                  <DiffTable
                    entities={result.diff.entities}
                    expanded={expanded}
                    onToggle={toggle}
                    keyPrefix={`${svc}:`}
                  />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DiffTable({
  entities,
  expanded,
  onToggle,
  keyPrefix,
}: {
  entities: EntityDiff[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  keyPrefix: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Element</th>
            <th>Model Type</th>
            <th>DB Type</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {entities.map(entity => {
            const key = `${keyPrefix}${entity.physicalTableName}`;
            const isExp = expanded.has(key);
            const gapCount = entity.attributes.filter(a => a.status !== 'matched').length;
            return (
              <EntityRows
                key={key}
                entity={entity}
                isExpanded={isExp}
                gapCount={gapCount}
                onToggle={() => onToggle(key)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EntityRows({ entity, isExpanded, gapCount, onToggle }: {
  entity: EntityDiff; isExpanded: boolean; gapCount: number; onToggle: () => void;
}) {
  const hasChildren = entity.attributes.length > 0;
  return (
    <>
      <tr className="hover font-semibold">
        <td>
          <div className="flex items-center gap-1">
            {hasChildren ? (
              <button className="btn btn-ghost btn-xs px-0 min-h-0 h-5 w-5" onClick={onToggle}>
                <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ) : <span className="w-5" />}
            {entity.entityName}
            {entity.physicalTableName && <span className="text-xs text-base-content/40 ml-1">({entity.physicalTableName})</span>}
          </div>
        </td>
        <td></td>
        <td></td>
        <td>
          {entity.status === 'modelOnly' && <span className="badge badge-info badge-xs">model only</span>}
          {entity.status === 'dbOnly' && <span className="badge badge-warning badge-xs">DB only</span>}
        </td>
        <td className="text-xs text-base-content/50">{gapCount > 0 && `${gapCount} gaps`}</td>
      </tr>
      {isExpanded && entity.attributes.map((attr, i) => (
        <tr key={`${entity.physicalTableName}-${i}`} className="hover">
          <td>
            <div className="flex items-center gap-1" style={{ paddingLeft: '1.5rem' }}>
              <span className={statusStyles[attr.status]?.color || ''}>{statusStyles[attr.status]?.icon}</span>
              {attr.attributeName}
              {attr.physicalColumnName && attr.physicalColumnName !== attr.attributeName && (
                <span className="text-xs text-base-content/40">({attr.physicalColumnName})</span>
              )}
            </div>
          </td>
          <td className="text-xs font-mono">{attr.model?.type || ''}</td>
          <td className="text-xs font-mono">{attr.source?.type || ''}</td>
          <td><span className={`badge badge-xs ${
            attr.status === 'matched' ? 'badge-success' :
            attr.status === 'drifted' ? 'badge-warning' :
            attr.status === 'orphaned' ? 'badge-error' :
            attr.status === 'dbOnly' ? 'badge-warning' :
            'badge-info'
          }`}>{statusStyles[attr.status]?.label}</span></td>
          <td className="text-xs text-base-content/50">{attr.driftFields?.join(', ')}</td>
        </tr>
      ))}
    </>
  );
}
