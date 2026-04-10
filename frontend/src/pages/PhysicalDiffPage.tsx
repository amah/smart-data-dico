import { useState, useCallback } from 'react';
import { servicesApi } from '../services/api';
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

const statusStyles: Record<string, { color: string; label: string; icon: string }> = {
  matched: { color: 'text-success', label: 'Matched', icon: '✓' },
  modelOnly: { color: 'text-info', label: 'Model only', icon: '🚧' },
  orphaned: { color: 'text-error', label: 'Orphaned', icon: '✗' },
  dbOnly: { color: 'text-warning', label: 'DB only', icon: '🆕' },
  drifted: { color: 'text-warning', label: 'Drifted', icon: '⚠' },
};

export default function PhysicalDiffPage() {
  const [services, setServices] = useState<string[]>([]);
  const [service, setService] = useState('');
  const [sql, setSql] = useState('');
  const [diff, setDiff] = useState<PhysicalDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useState(() => {
    servicesApi.getAllServices().then((data: any) => setServices(data.data || [])).catch(() => {});
  });

  const runDiff = useCallback(async () => {
    if (!service || !sql.trim()) return;
    setLoading(true);
    setError(null);
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
  }, [service, sql]);

  const toggle = useCallback((key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Physical Sync</h1>
        <p className="text-base-content/70 mt-1">Compare model physical metadata against a database schema</p>
      </div>

      <div className="card bg-base-200 p-4 space-y-3">
        <div className="flex items-end gap-4">
          <div className="form-control">
            <label className="label"><span className="label-text">Service</span></label>
            <select className="select select-sm select-bordered" value={service} onChange={e => setService(e.target.value)}>
              <option value="">Select...</option>
              {services.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button className="btn btn-sm btn-primary" onClick={runDiff} disabled={!service || !sql.trim() || loading}>
            {loading ? <span className="loading loading-spinner loading-xs" /> : 'Compare'}
          </button>
        </div>
        <textarea
          className="textarea textarea-bordered w-full font-mono text-xs"
          rows={6}
          placeholder="Paste SQL DDL here (CREATE TABLE statements)..."
          value={sql}
          onChange={e => setSql(e.target.value)}
        />
      </div>

      {error && <div className="alert alert-error"><span>{error}</span></div>}

      {diff && (
        <>
          <div className="stats stats-horizontal shadow w-full">
            {(['matched', 'modelOnly', 'orphaned', 'dbOnly', 'drifted'] as const).map(key => (
              <div key={key} className="stat">
                <div className="stat-title">{statusStyles[key].label}</div>
                <div className={`stat-value text-lg ${statusStyles[key].color}`}>{diff.summary[key]}</div>
              </div>
            ))}
          </div>

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
                {diff.entities.map(entity => {
                  const isExp = expanded.has(entity.physicalTableName);
                  const gapCount = entity.attributes.filter(a => a.status !== 'matched').length;
                  return (
                    <EntityRows
                      key={entity.physicalTableName || entity.entityName}
                      entity={entity}
                      isExpanded={isExp}
                      gapCount={gapCount}
                      onToggle={() => toggle(entity.physicalTableName)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
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
