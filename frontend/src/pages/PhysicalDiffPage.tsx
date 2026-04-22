/**
 * Physical sync diff — Phase 4.6 redesign.
 *
 * Chrome-level port onto tokens + Toolbar + StatusChip + Summary tiles;
 * the DDL / live-introspection form and the single-vs-all-services
 * dual-mode flow are preserved as-is (see the prior revision for the
 * data contract).
 */

import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { servicesApi, diffApi } from '../services/api';
import axios from 'axios';
import {
  Button,
  Chip,
  Icon,
  Toolbar,
} from '../components/ui';

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

interface PerServiceSourceState {
  type: 'ddl' | 'live';
  sql?: string;
  user?: string;
  password?: string;
}

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

const STATUS_META: Record<AttrStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'accent'; glyph: string }> = {
  matched:   { label: 'Matched',    tone: 'success', glyph: '✓' },
  modelOnly: { label: 'Model only', tone: 'info',    glyph: '◎' },
  orphaned:  { label: 'Orphaned',   tone: 'danger',  glyph: '✗' },
  dbOnly:    { label: 'DB only',    tone: 'warning', glyph: '+' },
  drifted:   { label: 'Drifted',    tone: 'warning', glyph: '⚠' },
};

const ALL = '__all__';

export default function PhysicalDiffPage() {
  const [services, setServices] = useState<string[]>([]);
  const [service, setService] = useState('');
  const [sql, setSql] = useState('');
  const [diff, setDiff] = useState<PhysicalDiff | null>(null);
  const [perService, setPerService] = useState<Record<string, PerServiceSourceState>>({});
  const [physicalConfigs, setPhysicalConfigs] = useState<Record<string, any>>({});
  const [allDiff, setAllDiff] = useState<AllPhysicalDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    servicesApi.getAllServices().then((data: any) => setServices(data.data || [])).catch(() => {});
  }, []);

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
      setLoading(true);
      setError(null);
      setAllDiff(null);
      try {
        const sources: Record<string, any> = {};
        for (const svc of services) {
          const s = perService[svc];
          if (!s) continue;
          if (s.type === 'ddl') {
            if (!s.sql?.trim()) continue;
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
    <div className="flex flex-col gap-3" style={{ padding: 12 }}>
      <div>
        <h1
          className="mono"
          style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600, margin: 0 }}
        >
          Physical sync
        </h1>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
          Compare model physical metadata against a database schema. Pick a single
          service or <strong>All services</strong> to diff the whole model at once.
        </p>
      </div>

      {/* Source config card */}
      <div
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <Field label="Service">
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              style={fieldStyle}
            >
              <option value="">Select…</option>
              <option value={ALL}>All services (whole model)</option>
              {services.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Button
            size="md"
            variant="primary"
            icon="branch"
            onClick={runDiff}
            disabled={
              loading ||
              (!isAllMode && (!service || !sql.trim())) ||
              (isAllMode && services.length === 0)
            }
          >
            {loading ? 'Comparing…' : 'Compare'}
          </Button>
        </div>

        {!isAllMode && (
          <textarea
            rows={6}
            placeholder="Paste SQL DDL here (CREATE TABLE …)"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            style={{
              ...fieldStyle,
              height: 'auto',
              padding: '8px 10px',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-xs)',
              resize: 'vertical',
            }}
          />
        )}

        {isAllMode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              Configure each service's source. Live introspection uses the persisted
              physical config; credentials are never saved on disk.
            </div>
            {services.map(svc => {
              const s = perService[svc] || { type: 'ddl' };
              const cfg = physicalConfigs[svc];
              return (
                <div
                  key={svc}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-subtle)',
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="mono" style={{ fontWeight: 500 }}>{svc}</span>
                    <div style={{ flex: 1 }} />
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 'var(--fs-xs)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <input
                        type="radio"
                        checked={s.type === 'ddl'}
                        onChange={() => updatePerService(svc, { type: 'ddl' })}
                      />
                      DDL paste
                    </label>
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 'var(--fs-xs)',
                        color: cfg ? 'var(--text-muted)' : 'var(--text-subtle)',
                        opacity: cfg ? 1 : 0.5,
                      }}
                    >
                      <input
                        type="radio"
                        checked={s.type === 'live'}
                        disabled={!cfg}
                        onChange={() => updatePerService(svc, { type: 'live' })}
                      />
                      Live ({cfg ? cfg.dialect : 'no physical.yaml'})
                    </label>
                  </div>
                  {s.type === 'ddl' && (
                    <textarea
                      rows={3}
                      placeholder={`CREATE TABLE… (DDL for ${svc}, or leave blank to skip)`}
                      value={s.sql || ''}
                      onChange={(e) => updatePerService(svc, { sql: e.target.value })}
                      style={{
                        ...fieldStyle,
                        height: 'auto',
                        padding: '6px 8px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-xs)',
                      }}
                    />
                  )}
                  {s.type === 'live' && cfg && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <input
                        type="text"
                        placeholder="User"
                        value={s.user || ''}
                        onChange={(e) => updatePerService(svc, { user: e.target.value })}
                        style={fieldStyle}
                      />
                      <input
                        type="password"
                        placeholder="Password"
                        value={s.password || ''}
                        onChange={(e) => updatePerService(svc, { password: e.target.value })}
                        style={fieldStyle}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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

      {/* Single-service result */}
      {diff && !isAllMode && (
        <>
          <SummaryTiles counts={diff.summary} />
          <DiffTable
            entities={diff.entities}
            expanded={expanded}
            onToggle={toggle}
            keyPrefix=""
          />
        </>
      )}

      {/* All-services result */}
      {allDiff && isAllMode && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
            }}
          >
            <Tile label="Services" value={allDiff.summary.services} />
            <Tile label="OK" value={allDiff.summary.ok} tone="success" />
            <Tile label="Failed" value={allDiff.summary.failed} tone={allDiff.summary.failed > 0 ? 'danger' : 'muted'} />
            <Tile label="Matched" value={allDiff.summary.matched} tone="success" />
            <Tile label="Drifted" value={allDiff.summary.drifted} tone={allDiff.summary.drifted > 0 ? 'warning' : 'muted'} />
            <Tile label="Model only" value={allDiff.summary.modelOnly} tone="info" />
            <Tile label="Orphaned" value={allDiff.summary.orphaned} tone={allDiff.summary.orphaned > 0 ? 'danger' : 'muted'} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Object.entries(allDiff.byService).map(([svc, result]) => (
              <div
                key={svc}
                style={{
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <h3
                    className="mono"
                    style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, margin: 0 }}
                  >
                    {svc}
                  </h3>
                  <div style={{ flex: 1 }} />
                  {result.status === 'error' && <Chip tone="danger" soft>error</Chip>}
                  {result.status === 'ok' && (
                    <>
                      <Chip tone="success" soft>{result.diff.summary.matched} matched</Chip>
                      {result.diff.summary.drifted > 0 && (
                        <Chip tone="warning" soft>{result.diff.summary.drifted} drifted</Chip>
                      )}
                    </>
                  )}
                </div>
                {result.status === 'error' && (
                  <div
                    className="mono"
                    style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}
                  >
                    {result.error}
                  </div>
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

      {!diff && !allDiff && !loading && !error && (
        <Toolbar>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}>
            Select a service and a source to compare.
          </span>
        </Toolbar>
      )}
    </div>
  );
}

// ──────────────── Sub-components ────────────────

const SummaryTiles = ({ counts }: { counts: PhysicalDiff['summary'] }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap: 10,
    }}
  >
    <Tile label="Matched"    value={counts.matched}   tone="success" />
    <Tile label="Drifted"    value={counts.drifted}   tone={counts.drifted > 0 ? 'warning' : 'muted'} />
    <Tile label="Model only" value={counts.modelOnly} tone="info" />
    <Tile label="Orphaned"   value={counts.orphaned}  tone={counts.orphaned > 0 ? 'danger' : 'muted'} />
    <Tile label="DB only"    value={counts.dbOnly}    tone={counts.dbOnly > 0 ? 'warning' : 'muted'} />
  </div>
);

interface TileProps {
  label: string;
  value: number;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'muted';
}

const Tile = ({ label, value, tone = 'muted' }: TileProps) => {
  const color =
    tone === 'success' ? 'var(--success)' :
    tone === 'warning' ? 'var(--warning)' :
    tone === 'danger'  ? 'var(--danger)' :
    tone === 'info'    ? 'var(--text-muted)' :
                         'var(--text)';
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '10px 12px',
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
      <div
        className="mono"
        style={{
          fontSize: 'var(--fs-2xl)',
          fontWeight: 600,
          color,
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>{label}</span>
    {children}
  </label>
);

// ──────────────── Diff table ────────────────

interface DiffTableProps {
  entities: EntityDiff[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  keyPrefix: string;
}

const DiffTable = ({ entities, expanded, onToggle, keyPrefix }: DiffTableProps) => (
  <div
    style={{
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}
  >
    <div
      role="table"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(200px, 1.4fr) 100px 100px 120px minmax(140px, 1fr)',
        fontSize: 'var(--fs-md)',
      }}
    >
      <HeaderCell>Element</HeaderCell>
      <HeaderCell>Model type</HeaderCell>
      <HeaderCell>DB type</HeaderCell>
      <HeaderCell>Status</HeaderCell>
      <HeaderCell>Details</HeaderCell>

      {entities.map((entity) => {
        const key = `${keyPrefix}${entity.physicalTableName}`;
        const isExp = expanded.has(key);
        const gapCount = entity.attributes.filter(a => a.status !== 'matched').length;
        const hasChildren = entity.attributes.length > 0;
        return (
          <EntityRows
            key={key}
            entity={entity}
            isExpanded={isExp}
            hasChildren={hasChildren}
            gapCount={gapCount}
            onToggle={() => onToggle(key)}
          />
        );
      })}
    </div>
  </div>
);

const HeaderCell = ({ children }: { children: React.ReactNode }) => (
  <div
    role="columnheader"
    style={{
      padding: '7px 10px',
      fontSize: 'var(--fs-sm)',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      color: 'var(--text-muted)',
      background: 'var(--bg-subtle)',
      borderBottom: '1px solid var(--border-strong)',
    }}
  >
    {children}
  </div>
);

interface EntityRowsProps {
  entity: EntityDiff;
  isExpanded: boolean;
  hasChildren: boolean;
  gapCount: number;
  onToggle: () => void;
}

const EntityRows = ({ entity, isExpanded, hasChildren, gapCount, onToggle }: EntityRowsProps) => (
  <>
    <div role="row" style={{ display: 'contents' }}>
      <div
        role="cell"
        onClick={hasChildren ? onToggle : undefined}
        style={{
          padding: '0 10px',
          height: 'var(--row-height, 36px)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: '1px solid var(--border)',
          cursor: hasChildren ? 'pointer' : 'default',
          fontWeight: 500,
        }}
      >
        {hasChildren ? (
          <Icon
            name="chevron"
            size={10}
            style={{
              transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              color: 'var(--text-subtle)',
              transition: 'transform var(--dur-fast)',
            }}
          />
        ) : <span style={{ width: 10 }} />}
        <span className="mono">{entity.entityName}</span>
        {entity.physicalTableName && entity.physicalTableName !== entity.entityName && (
          <span
            className="mono"
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}
          >
            ({entity.physicalTableName})
          </span>
        )}
      </div>
      <div role="cell" style={cellStyle} />
      <div role="cell" style={cellStyle} />
      <div role="cell" style={cellStyle}>
        {entity.status === 'modelOnly' && <Chip tone="info" soft>model only</Chip>}
        {entity.status === 'dbOnly' && <Chip tone="warning" soft>DB only</Chip>}
      </div>
      <div role="cell" style={{ ...cellStyle, color: 'var(--text-subtle)', fontSize: 'var(--fs-xs)' }}>
        {gapCount > 0 ? `${gapCount} gap${gapCount === 1 ? '' : 's'}` : ''}
      </div>
    </div>
    {isExpanded && entity.attributes.map((attr, i) => {
      const meta = STATUS_META[attr.status];
      return (
        <div key={`${entity.physicalTableName}-${i}`} role="row" style={{ display: 'contents' }}>
          <div role="cell" style={{ ...cellStyle, paddingLeft: 30 }}>
            <span
              className="mono"
              style={{
                fontSize: 'var(--fs-md)',
                color: `var(--${meta.tone === 'info' ? 'text-muted' : meta.tone})`,
              }}
            >
              {meta.glyph}
            </span>
            <span className="mono" style={{ marginLeft: 6 }}>{attr.attributeName}</span>
            {attr.physicalColumnName && attr.physicalColumnName !== attr.attributeName && (
              <span
                className="mono"
                style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginLeft: 6 }}
              >
                ({attr.physicalColumnName})
              </span>
            )}
          </div>
          <div role="cell" style={{ ...cellStyle, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)' }}>
            {attr.model?.type || ''}
          </div>
          <div role="cell" style={{ ...cellStyle, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)' }}>
            {attr.source?.type || ''}
          </div>
          <div role="cell" style={cellStyle}>
            <Chip
              tone={meta.tone === 'info' ? 'info' : meta.tone}
              soft
            >
              {meta.label}
            </Chip>
          </div>
          <div role="cell" style={{ ...cellStyle, fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
            {attr.driftFields?.join(', ')}
          </div>
        </div>
      );
    })}
  </>
);

const cellStyle = {
  padding: '0 10px',
  height: 'var(--row-height, 36px)',
  display: 'flex' as const,
  alignItems: 'center' as const,
  borderBottom: '1px solid var(--border)',
  gap: 6,
  color: 'var(--text)',
} as const;

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
