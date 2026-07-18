/**
 * Physical sync diff — Phase 4.6 redesign.
 *
 * Chrome-level port onto tokens + Toolbar + StatusChip + Summary tiles;
 * the DDL / live-introspection form and the single-vs-all-services
 * dual-mode flow are preserved as-is (see the prior revision for the
 * data contract).
 */

import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { servicesApi } from '../services/api';
import { useCommand } from '../kernel/useCommand';
import type {
  DdlOperation,
  ImpactDiffResult,
  MigrationFormat,
  PhysicalConfig,
  PhysicalDiffSource,
} from '../plugins/data-dictionary/services/DiffService';
import {
  Button,
  Chip,
  Icon,
  Toolbar,
} from '../components/ui';

type AttrStatus = 'matched' | 'modelOnly' | 'orphaned' | 'dbOnly' | 'drifted';

interface PhysicalDiff {
  entities: EntityDiff[];
  summary: {
    matched: number;
    modelOnly: number;
    orphaned: number;
    dbOnly: number;
    drifted: number;
    entities: Record<string, number>;
    constraints?: ConstraintCounts;
  };
}

interface ConstraintCounts { matched: number; added: number; removed: number; drifted: number }

interface EntityDiff {
  status: string;
  entityName: string;
  entityUuid?: string;
  physicalTableName: string;
  attributes: AttrDiff[];
  constraints: ConstraintDiff[];
}

interface ConstraintDiff {
  status: 'matched' | 'added' | 'removed' | 'drifted';
  key: string;
  model?: { kind?: string; name?: string; columns?: string[] };
  source?: { kind?: string; name?: string; columns?: string[] };
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
    constraints?: ConstraintCounts;
  };
}

const entityDiffKey = (entity: EntityDiff): string =>
  entity.physicalTableName || entity.entityUuid || `name:${entity.entityName}`;

const STATUS_META: Record<AttrStatus, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'accent'; glyph: string }> = {
  matched:   { label: 'Matched',    tone: 'success', glyph: '✓' },
  modelOnly: { label: 'Model only', tone: 'info',    glyph: '◎' },
  orphaned:  { label: 'Orphaned',   tone: 'danger',  glyph: '✗' },
  dbOnly:    { label: 'DB only',    tone: 'warning', glyph: '+' },
  drifted:   { label: 'Drifted',    tone: 'warning', glyph: '⚠' },
};

const physicalMetadataValue = (side: any, name: string): unknown =>
  side?.metadata?.find((entry: any) => entry.name === name)?.value;

export const formatPhysicalAttributeSide = (side: any): string => {
  if (!side) return '';
  const dbType = physicalMetadataValue(side, 'physical.dbType');
  const nullable = physicalMetadataValue(side, 'physical.nullable');
  return [
    side.type,
    dbType && `DB ${dbType}`,
    side.primaryKey && 'primary key',
    side.unique && 'unique',
    side.required === true ? 'required' : side.required === false ? 'optional' : undefined,
    nullable === true ? 'NULL' : nullable === false ? 'NOT NULL' : undefined,
    side.defaultValue !== undefined && side.defaultValue !== null ? `default ${JSON.stringify(side.defaultValue)}` : undefined,
  ].filter(Boolean).join(' · ');
};

const formatPhysicalConstraintSide = (side: ConstraintDiff['model']): string => {
  if (!side) return '';
  return [side.kind, side.columns?.length ? `(${side.columns.join(', ')})` : undefined].filter(Boolean).join(' ');
};

const ALL = '__all__';

export default function PhysicalDiffPage() {
  const run = useCommand();
  const [services, setServices] = useState<string[]>([]);
  const [service, setService] = useState('');
  const [sql, setSql] = useState('');
  const [singleSourceType, setSingleSourceType] = useState<'ddl' | 'live'>('ddl');
  const [singleCredentials, setSingleCredentials] = useState({ user: '', password: '' });
  const [singleConfig, setSingleConfig] = useState<PhysicalConfig>(null);
  const [diff, setDiff] = useState<PhysicalDiff | null>(null);
  const [perService, setPerService] = useState<Record<string, PerServiceSourceState>>({});
  const [physicalConfigs, setPhysicalConfigs] = useState<Record<string, PhysicalConfig>>({});
  const [allDiff, setAllDiff] = useState<AllPhysicalDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [impact, setImpact] = useState<ImpactDiffResult | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [migrationFormat, setMigrationFormat] = useState<MigrationFormat>('sql');
  const [skipDestructive, setSkipDestructive] = useState(true);

  useEffect(() => {
    servicesApi.getAllServices().then((data: any) => setServices(data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (service !== ALL || services.length === 0) return;
    const seed: Record<string, PerServiceSourceState> = {};
    const configs: Record<string, PhysicalConfig> = {};
    Promise.all(
      services.map(async svc => {
        try {
          const cfg = await run('data-dictionary.diff.getPhysicalConfig', { service: svc });
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
  }, [service, services, run]);

  useEffect(() => {
    if (!service || service === ALL) {
      setSingleConfig(null);
      return;
    }
    run('data-dictionary.diff.getPhysicalConfig', { service })
      .then(setSingleConfig)
      .catch(() => setSingleConfig(null));
  }, [service, run]);

  const getSingleSource = useCallback((): PhysicalDiffSource | null => {
    if (singleSourceType === 'ddl') {
      return sql.trim() ? { type: 'ddl', sql } : null;
    }
    return singleCredentials.user && singleCredentials.password
      ? { type: 'live', credentials: singleCredentials }
      : null;
  }, [singleSourceType, singleCredentials, sql]);

  const getAllSources = useCallback((): Record<string, PhysicalDiffSource> => {
    const sources: Record<string, PhysicalDiffSource> = {};
    for (const svc of services) {
      const source = perService[svc];
      if (!source) continue;
      if (source.type === 'ddl' && source.sql?.trim()) {
        sources[svc] = { type: 'ddl', sql: source.sql };
      } else if (source.type === 'live' && source.user && source.password) {
        sources[svc] = { type: 'live', credentials: { user: source.user, password: source.password } };
      }
    }
    return sources;
  }, [perService, services]);

  const runDiff = useCallback(async () => {
    if (service === ALL) {
      setLoading(true);
      setError(null);
      setAllDiff(null);
      setImpact(null);
      try {
        const sources = getAllSources();
        if (Object.keys(sources).length === 0) {
          setError('Provide a source for at least one service.');
          setLoading(false);
          return;
        }
        const result = await run('data-dictionary.diff.getPhysicalAll', { sources, services: Object.keys(sources) });
        const allDiff = result as AllPhysicalDiff;
        setAllDiff(allDiff);
        const exp = new Set<string>();
        for (const [svc, r] of Object.entries(allDiff.byService) as [string, any][]) {
          if (r.status === 'ok') {
            for (const e of r.diff.entities) {
              if (e.attributes.some((a: AttrDiff) => a.status !== 'matched') || e.constraints.some((c: ConstraintDiff) => c.status !== 'matched')) {
                exp.add(`${svc}:${entityDiffKey(e)}`);
              }
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

    const source = getSingleSource();
    if (!service || !source) return;
    setLoading(true);
    setError(null);
    setAllDiff(null);
    setImpact(null);
    try {
      const result = await run('data-dictionary.diff.getPhysicalForService', { service, source });
      const data = result as PhysicalDiff;
      setDiff(data);
      const exp = new Set<string>();
      for (const e of data.entities) {
        if (e.attributes.some((a: AttrDiff) => a.status !== 'matched') || e.constraints.some((c: ConstraintDiff) => c.status !== 'matched')) {
          exp.add(entityDiffKey(e));
        }
      }
      setExpanded(exp);
    } catch (e: any) {
      setError(e.response?.data?.message || e.message || 'Failed');
    } finally {
      setLoading(false);
    }
  }, [service, services, run, getAllSources, getSingleSource]);

  const previewImpact = useCallback(async () => {
    setImpactLoading(true);
    setError(null);
    try {
      if (service === ALL) {
        const sources = getAllSources();
        const result = await run('data-dictionary.diff.getImpactAll', { sources, services: Object.keys(sources) });
        setImpact(result);
      } else {
        const source = getSingleSource();
        if (!source) return;
        const result = await run('data-dictionary.diff.getImpactForService', {
          service,
          source,
          dialect: singleConfig?.dialect,
        });
        setImpact(result);
      }
    } catch (e: any) {
      setError(e.response?.data?.message || e.message || 'Failed to build migration preview');
    } finally {
      setImpactLoading(false);
    }
  }, [getAllSources, getSingleSource, run, service, singleConfig]);

  const downloadMigration = useCallback(async () => {
    if (!impact) return;
    try {
      const options = { skipDestructive };
      const download = service === ALL
        ? await run('data-dictionary.diff.exportMigrationAll', { operations: impact.operations, format: migrationFormat, options, mode: 'combined' })
        : await run('data-dictionary.diff.exportMigration', { operations: impact.operations, format: migrationFormat, options, dialect: singleConfig?.dialect });
      const url = URL.createObjectURL(download.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = download.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.response?.data?.message || e.message || 'Failed to export migration');
    }
  }, [impact, migrationFormat, run, service, singleConfig, skipDestructive]);

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
              onChange={(e) => {
                setService(e.target.value);
                setDiff(null);
                setAllDiff(null);
                setImpact(null);
              }}
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
              (!isAllMode && (!service || !getSingleSource())) ||
              (isAllMode && services.length === 0)
            }
          >
            {loading ? 'Comparing…' : 'Compare'}
          </Button>
        </div>

        {!isAllMode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)' }}>
                <input type="radio" checked={singleSourceType === 'ddl'} onChange={() => setSingleSourceType('ddl')} />
                DDL paste
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)', opacity: singleConfig ? 1 : 0.5 }}>
                <input
                  type="radio"
                  checked={singleSourceType === 'live'}
                  disabled={!singleConfig}
                  onChange={() => setSingleSourceType('live')}
                />
                Live ({singleConfig?.dialect || 'no physical.yaml'})
              </label>
            </div>
            {singleSourceType === 'ddl' ? (
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
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input
                  type="text"
                  aria-label="Database user"
                  placeholder="Database user"
                  value={singleCredentials.user}
                  onChange={(e) => setSingleCredentials(value => ({ ...value, user: e.target.value }))}
                  style={fieldStyle}
                />
                <input
                  type="password"
                  aria-label="Database password"
                  placeholder="Database password"
                  value={singleCredentials.password}
                  onChange={(e) => setSingleCredentials(value => ({ ...value, password: e.target.value }))}
                  style={fieldStyle}
                />
              </div>
            )}
          </div>
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
            <Tile
              label="Constraint gaps"
              value={(allDiff.summary.constraints?.added || 0) + (allDiff.summary.constraints?.removed || 0) + (allDiff.summary.constraints?.drifted || 0)}
              tone="warning"
            />
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

      {(diff || allDiff) && (
        <Toolbar>
          <Button
            size="md"
            variant="primary"
            icon="branch"
            onClick={previewImpact}
            disabled={impactLoading}
          >
            {impactLoading ? 'Building preview…' : 'Preview migration impact'}
          </Button>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
            Generates an ordered preview only; nothing is executed against the database.
          </span>
        </Toolbar>
      )}

      {impact && (
        <section
          data-testid="migration-impact"
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            <strong>Migration impact</strong>
            <Chip tone="success" soft>{impact.summary.safe} safe</Chip>
            <Chip tone="warning" soft>{impact.summary.caution} caution</Chip>
            <Chip tone="danger" soft>{impact.summary.destructive} destructive</Chip>
            <div style={{ flex: 1 }} />
            <select
              aria-label="Migration format"
              value={migrationFormat}
              onChange={(e) => setMigrationFormat(e.target.value as MigrationFormat)}
              style={fieldStyle}
            >
              <option value="sql">SQL</option>
              <option value="flyway-sql">Flyway SQL</option>
              <option value="liquibase-xml">Liquibase XML</option>
              <option value="liquibase-yaml">Liquibase YAML</option>
            </select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-xs)' }}>
              <input type="checkbox" checked={skipDestructive} onChange={(e) => setSkipDestructive(e.target.checked)} />
              Skip destructive
            </label>
            <Button size="sm" variant="secondary" onClick={downloadMigration}>Download</Button>
          </div>
          {impact.operations.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--text-subtle)' }}>No migration operations required.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {impact.operations.map((operation: DdlOperation, index) => (
                <div
                  key={`${operation.service || service}-${operation.order}-${index}`}
                  style={{ display: 'grid', gridTemplateColumns: '36px 140px minmax(120px, 1fr) 100px', gap: 8, padding: '7px 12px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}
                >
                  <span className="mono" style={{ color: 'var(--text-subtle)' }}>{operation.order}</span>
                  <span className="mono">{operation.type}</span>
                  <span className="mono">{operation.service ? `${operation.service} · ` : ''}{operation.table}{operation.column ? `.${operation.column}` : ''}</span>
                  <Chip tone={operation.risk === 'destructive' ? 'danger' : operation.risk === 'caution' ? 'warning' : 'success'} soft>
                    {operation.risk}
                  </Chip>
                </div>
              ))}
            </div>
          )}
        </section>
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
    <Tile
      label="Constraint gaps"
      value={(counts.constraints?.added || 0) + (counts.constraints?.removed || 0) + (counts.constraints?.drifted || 0)}
      tone={(counts.constraints?.added || counts.constraints?.removed || counts.constraints?.drifted) ? 'warning' : 'muted'}
    />
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
      overflowX: 'auto',
    }}
  >
    <div
      role="table"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(200px, 1.2fr) minmax(210px, 1fr) minmax(210px, 1fr) 120px minmax(150px, 0.8fr)',
        minWidth: 980,
        fontSize: 'var(--fs-md)',
      }}
    >
      <HeaderCell>Element</HeaderCell>
      <HeaderCell>Expected (model)</HeaderCell>
      <HeaderCell>Actual (database)</HeaderCell>
      <HeaderCell>Status</HeaderCell>
      <HeaderCell>Details</HeaderCell>

      {entities.map((entity) => {
        const key = `${keyPrefix}${entityDiffKey(entity)}`;
        const isExp = expanded.has(key);
        const gapCount = entity.attributes.filter(a => a.status !== 'matched').length
          + entity.constraints.filter(c => c.status !== 'matched').length;
        const hasChildren = entity.attributes.length > 0 || entity.constraints.length > 0;
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
      <PhysicalValueCell
        value={entity.status === 'dbOnly' ? '' : entity.physicalTableName || entity.entityName}
        missing={entity.status === 'dbOnly'}
        gap={entity.status !== 'matched'}
      />
      <PhysicalValueCell
        value={entity.status === 'modelOnly' ? '' : entity.physicalTableName || entity.entityName}
        missing={entity.status === 'modelOnly'}
        gap={entity.status !== 'matched'}
      />
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
          <PhysicalValueCell
            value={formatPhysicalAttributeSide(attr.model)}
            missing={!attr.model}
            gap={attr.status !== 'matched'}
            drifted={attr.status === 'drifted'}
          />
          <PhysicalValueCell
            value={formatPhysicalAttributeSide(attr.source)}
            missing={!attr.source}
            gap={attr.status !== 'matched'}
            drifted={attr.status === 'drifted'}
          />
          <div role="cell" style={cellStyle}>
            <Chip
              tone={meta.tone === 'info' ? 'info' : meta.tone}
              soft
            >
              {meta.label}
            </Chip>
          </div>
          <div role="cell" style={{ ...cellStyle, fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', flexWrap: 'wrap' }}>
            {attr.driftFields?.map(field => <Chip key={field} tone="warning" soft>{field}</Chip>)}
            {!attr.driftFields?.length && attr.status !== 'matched' ? 'Missing on one side' : ''}
          </div>
        </div>
      );
    })}
    {isExpanded && entity.constraints.map((constraint, i) => {
      const isGap = constraint.status !== 'matched';
      const label = constraint.model?.name || constraint.source?.name || constraint.key.replace(/^name:/, '');
      return (
        <div key={`${entity.physicalTableName}-constraint-${i}`} role="row" style={{ display: 'contents' }}>
          <div role="cell" style={{ ...cellStyle, paddingLeft: 30 }}>
            <span className="mono" style={{ color: isGap ? 'var(--warning)' : 'var(--success)' }}>◇</span>
            <span className="mono" style={{ marginLeft: 6 }}>{label}</span>
          </div>
          <PhysicalValueCell
            value={formatPhysicalConstraintSide(constraint.model)}
            missing={!constraint.model}
            gap={isGap}
            drifted={constraint.status === 'drifted'}
          />
          <PhysicalValueCell
            value={formatPhysicalConstraintSide(constraint.source)}
            missing={!constraint.source}
            gap={isGap}
            drifted={constraint.status === 'drifted'}
          />
          <div role="cell" style={cellStyle}>
            <Chip tone={constraint.status === 'matched' ? 'success' : constraint.status === 'removed' ? 'danger' : 'warning'} soft>
              {constraint.status}
            </Chip>
          </div>
          <div role="cell" style={{ ...cellStyle, fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
            {constraint.status === 'drifted' ? 'Definitions differ' : isGap ? 'Missing on one side' : 'Same definition'}
          </div>
        </div>
      );
    })}
  </>
);

const PhysicalValueCell = ({ value, missing, gap, drifted = false }: {
  value: string;
  missing: boolean;
  gap: boolean;
  drifted?: boolean;
}) => (
  <div
    role="cell"
    title={value || 'Not present'}
    style={{
      ...cellStyle,
      minWidth: 0,
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--fs-xs)',
      color: missing ? 'var(--danger)' : 'var(--text)',
      background: missing ? 'var(--danger-soft)' : drifted ? 'var(--warning-soft)' : gap ? 'var(--bg-subtle)' : 'transparent',
      fontStyle: missing ? 'italic' : 'normal',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}
  >
    {value || 'Not present'}
  </div>
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
