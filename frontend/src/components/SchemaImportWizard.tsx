/**
 * Schema Import Wizard (#69 C4).
 *
 * Three-step flow that lets users import a database schema into a target
 * service without surprising overwrites:
 *
 *   1. Source        — paste SQL DDL, upload a .sql file, or connect to
 *                      an Oracle DB; pick the target service; configure
 *                      strip-prefix / strip-suffix rules. Calls
 *                      /api/import/sql-ddl/preview or
 *                      /api/import/oracle/preview to parse into entities.
 *
 *   2. Diff Preview  — calls /api/import/sql-ddl/diff and shows the
 *                      structured diff. Five categories per entity
 *                      (added, changed, unchanged, removedInSource,
 *                      modelOnly). User can expand each entity to see
 *                      attribute-level changes before committing.
 *
 *   3. Result        — calls /api/import/sql-ddl/commit to merge + write
 *                      and shows the per-status counts returned by the
 *                      backend (added / merged / unchanged / preserved).
 *
 * The wizard never writes to disk until the user clicks "Commit Import"
 * on the diff step. The merge logic on the backend (#69 C2) preserves
 * user-authored descriptions, non-physical metadata, and model-only
 * attributes — see schemaDiff.ts for the invariants.
 */
import { useState } from 'react';
import { useService } from '../kernel/useService';
import { IMPORT_EXPORT_SERVICE_TOKEN } from '../kernel/tokens';
import type { ImportExportService } from '../plugins/data-dictionary/services/ImportExportService';
import type { Entity, EntityDiff } from '../types';

type SourceKind = 'sql' | 'db';
type Dialect = 'oracle' | 'postgres' | 'mysql' | 'mssql';
type WizardStep = 'source' | 'diff' | 'result';

/**
 * Shape of every field the wizard can ask for across all dialects (#79/#80/#81).
 * Each dialect uses a subset — see `dialectFields` below.
 */
interface DbConnection {
  // Common
  user: string;
  password: string;
  database?: string;   // pg / mysql / mssql
  // Oracle
  connectString?: string;
  owner?: string;
  // pg / mysql
  host?: string;
  port?: string;       // kept as string in the form; converted on submit
  schema?: string;     // pg ('public'), mssql ('dbo')
  // mssql
  server?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

const dialectLabel: Record<Dialect, string> = {
  oracle: 'Oracle',
  postgres: 'PostgreSQL',
  mysql: 'MySQL / MariaDB',
  mssql: 'SQL Server',
};

/**
 * Required fields per dialect. Used to disable the Preview button until all
 * are filled in, and to strip empty optionals from the outgoing request.
 */
const dialectRequired: Record<Dialect, (keyof DbConnection)[]> = {
  oracle: ['user', 'password', 'connectString'],
  postgres: ['host', 'database', 'user', 'password'],
  mysql: ['host', 'database', 'user', 'password'],
  mssql: ['server', 'database', 'user', 'password'],
};

interface CommitResult {
  added: number;
  merged: number;
  unchanged: number;
  removedInSource: number;
  written: number;
  errors: string[];
}

interface Props {
  services: string[];
  /**
   * Called when the wizard finishes successfully — parent can refresh
   * its service / entity lists.
   */
  onComplete?: (result: CommitResult) => void;
}

export default function SchemaImportWizard({ services, onComplete }: Props) {
  const importExport = useService<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN);
  const [step, setStep] = useState<WizardStep>('source');
  const [sourceKind, setSourceKind] = useState<SourceKind>('sql');
  const [targetService, setTargetService] = useState('');

  // SQL paste / file
  const [sqlText, setSqlText] = useState('');

  // DB connection (any dialect)
  const [dialect, setDialect] = useState<Dialect>('oracle');
  const [dbConn, setDbConn] = useState<DbConnection>({ user: '', password: '' });

  // Name-derivation options
  const [stripPrefixes, setStripPrefixes] = useState('');
  const [stripSuffixes, setStripSuffixes] = useState('');

  // State carried between steps
  const [parsed, setParsed] = useState<Entity[]>([]);
  const [diffs, setDiffs] = useState<EntityDiff[]>([]);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setStep('source');
    setSqlText('');
    setDialect('oracle');
    setDbConn({ user: '', password: '' });
    setStripPrefixes('');
    setStripSuffixes('');
    setParsed([]);
    setDiffs([]);
    setCommitResult(null);
    setExpandedEntity(null);
    setError(null);
  };

  /**
   * Build the per-dialect `connection` payload from the form state.
   * Drops empty optional fields and parses `port` to a number.
   */
  const buildConnectionPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      user: dbConn.user,
      password: dbConn.password,
    };
    if (dialect === 'oracle') {
      payload.connectString = dbConn.connectString;
      if (dbConn.owner) payload.owner = dbConn.owner;
    } else if (dialect === 'postgres' || dialect === 'mysql') {
      payload.host = dbConn.host;
      payload.database = dbConn.database;
      if (dbConn.port) payload.port = Number(dbConn.port);
      if (dialect === 'postgres' && dbConn.schema) payload.schema = dbConn.schema;
    } else if (dialect === 'mssql') {
      payload.server = dbConn.server;
      payload.database = dbConn.database;
      if (dbConn.port) payload.port = Number(dbConn.port);
      if (dbConn.schema) payload.schema = dbConn.schema;
      payload.options = {
        encrypt: dbConn.encrypt ?? true,
        trustServerCertificate: dbConn.trustServerCertificate ?? false,
      };
    }
    return payload;
  };

  const dbFormComplete = dialectRequired[dialect].every(f => !!dbConn[f]);

  const buildOptions = () => ({
    stripPrefixes: stripPrefixes.split(',').map(s => s.trim()).filter(Boolean),
    stripSuffixes: stripSuffixes.split(',').map(s => s.trim()).filter(Boolean),
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSqlText(reader.result as string);
    reader.readAsText(file);
  };

  // ─── Step 1 → Step 2: parse + diff ─────────────────────────────────────
  const handlePreviewAndDiff = async () => {
    if (!targetService) {
      setError('Pick a target service first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Parse the source into entities
      const previewRes =
        sourceKind === 'sql'
          ? await importExport.previewSqlDdl(sqlText, buildOptions())
          : await importExport.previewDbSchema(dialect, buildConnectionPayload(), buildOptions());

      const parsedEntities = (previewRes.data?.entities || []) as Entity[];
      const previewErrors = (previewRes.data?.errors || []) as string[];

      if (parsedEntities.length === 0) {
        setError(previewErrors[0] || 'No entities parsed from the source.');
        return;
      }

      // Compute diff against the chosen service
      const diffRes = await importExport.diffSqlDdl(parsedEntities, targetService);
      const diffList = (diffRes.data?.diffs || []) as EntityDiff[];

      setParsed(parsedEntities);
      setDiffs(diffList);
      setStep('diff');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Preview failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 2 → Step 3: commit ───────────────────────────────────────────
  const handleCommit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await importExport.commitSqlDdl(parsed, targetService);
      const data = res.data as CommitResult;
      setCommitResult(data);
      setStep('result');
      onComplete?.(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Commit failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // ─── Diff summary aggregates ───────────────────────────────────────────
  const summary = diffs.reduce(
    (acc, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1;
      return acc;
    },
    { added: 0, changed: 0, unchanged: 0, removedInSource: 0 } as Record<string, number>,
  );

  const statusBadge = (status: string) => {
    const cls =
      status === 'added'
        ? 'badge-success'
        : status === 'changed'
          ? 'badge-warning'
          : status === 'removedInSource'
            ? 'badge-error'
            : status === 'modelOnly'
              ? 'badge-info'
              : 'badge-ghost';
    return <span className={`badge badge-sm ${cls}`}>{status}</span>;
  };

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Schema Import Wizard</h2>
        <p className="text-base-content/70 text-sm">
          Import tables from a SQL DDL script, file, or a live database (Oracle, Postgres, MySQL,
          SQL Server). Preview the diff before committing — your descriptions and model-only
          attributes are preserved.
        </p>
      </div>

      {/* Step indicator */}
      <ul className="steps steps-horizontal w-full">
        <li className={`step ${step !== 'source' ? 'step-primary' : 'step-primary'}`}>Source</li>
        <li className={`step ${step === 'diff' || step === 'result' ? 'step-primary' : ''}`}>Diff Preview</li>
        <li className={`step ${step === 'result' ? 'step-primary' : ''}`}>Result</li>
      </ul>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      {/* ─── Step 1: Source ─── */}
      {step === 'source' && (
        <div className="space-y-4">
          <div className="form-control">
            <label className="label" htmlFor="wizard-target-service">
              <span className="label-text">Target Service</span>
            </label>
            <select
              id="wizard-target-service"
              className="select select-bordered"
              value={targetService}
              onChange={e => setTargetService(e.target.value)}
            >
              <option value="">Select a service…</option>
              {services.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="tabs tabs-boxed w-fit">
            <button
              className={`tab ${sourceKind === 'sql' ? 'tab-active' : ''}`}
              onClick={() => setSourceKind('sql')}
            >
              SQL DDL (paste / file)
            </button>
            <button
              className={`tab ${sourceKind === 'db' ? 'tab-active' : ''}`}
              onClick={() => setSourceKind('db')}
            >
              Live Database
            </button>
          </div>

          {sourceKind === 'sql' && (
            <>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Upload .sql File</span>
                </label>
                <input
                  type="file"
                  className="file-input file-input-bordered file-input-sm"
                  accept=".sql,.txt"
                  onChange={handleFileUpload}
                />
              </div>
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Or paste SQL DDL</span>
                </label>
                <textarea
                  className="textarea textarea-bordered font-mono text-sm"
                  rows={10}
                  placeholder="CREATE TABLE orders (&#10;  id VARCHAR(36) PRIMARY KEY,&#10;  customer_email VARCHAR(255) NOT NULL&#10;);"
                  value={sqlText}
                  onChange={e => setSqlText(e.target.value)}
                />
              </div>
            </>
          )}

          {sourceKind === 'db' && (
            <div className="space-y-4">
              <div className="form-control">
                <label className="label" htmlFor="db-dialect">
                  <span className="label-text">Dialect</span>
                </label>
                <select
                  id="db-dialect"
                  className="select select-bordered"
                  value={dialect}
                  onChange={e => setDialect(e.target.value as Dialect)}
                >
                  {(Object.keys(dialectLabel) as Dialect[]).map(d => (
                    <option key={d} value={d}>{dialectLabel[d]}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Host field — oracle uses connectString instead */}
                {dialect !== 'oracle' && (
                  <div className="form-control md:col-span-2">
                    <label className="label" htmlFor="db-host">
                      <span className="label-text">{dialect === 'mssql' ? 'Server' : 'Host'}</span>
                    </label>
                    <input
                      id="db-host"
                      className="input input-bordered"
                      placeholder={dialect === 'mssql' ? 'db.example.com' : 'localhost'}
                      value={(dialect === 'mssql' ? dbConn.server : dbConn.host) || ''}
                      onChange={e =>
                        setDbConn(
                          dialect === 'mssql'
                            ? { ...dbConn, server: e.target.value }
                            : { ...dbConn, host: e.target.value },
                        )
                      }
                    />
                  </div>
                )}
                {dialect !== 'oracle' && (
                  <div className="form-control">
                    <label className="label" htmlFor="db-port">
                      <span className="label-text">
                        Port (optional — defaults to {dialect === 'postgres' ? 5432 : dialect === 'mysql' ? 3306 : 1433})
                      </span>
                    </label>
                    <input
                      id="db-port"
                      type="number"
                      className="input input-bordered"
                      value={dbConn.port || ''}
                      onChange={e => setDbConn({ ...dbConn, port: e.target.value })}
                    />
                  </div>
                )}
                {dialect !== 'oracle' && (
                  <div className="form-control">
                    <label className="label" htmlFor="db-database">
                      <span className="label-text">Database</span>
                    </label>
                    <input
                      id="db-database"
                      className="input input-bordered"
                      value={dbConn.database || ''}
                      onChange={e => setDbConn({ ...dbConn, database: e.target.value })}
                    />
                  </div>
                )}

                <div className="form-control">
                  <label className="label" htmlFor="db-user">
                    <span className="label-text">User</span>
                  </label>
                  <input
                    id="db-user"
                    className="input input-bordered"
                    value={dbConn.user}
                    onChange={e => setDbConn({ ...dbConn, user: e.target.value })}
                  />
                </div>
                <div className="form-control">
                  <label className="label" htmlFor="db-password">
                    <span className="label-text">Password</span>
                  </label>
                  <input
                    id="db-password"
                    type="password"
                    className="input input-bordered"
                    value={dbConn.password}
                    onChange={e => setDbConn({ ...dbConn, password: e.target.value })}
                  />
                </div>

                {/* Oracle-only */}
                {dialect === 'oracle' && (
                  <div className="form-control md:col-span-2">
                    <label className="label" htmlFor="db-connect-string">
                      <span className="label-text">Connect String (Easy Connect)</span>
                    </label>
                    <input
                      id="db-connect-string"
                      className="input input-bordered"
                      placeholder="host:1521/service_name"
                      value={dbConn.connectString || ''}
                      onChange={e => setDbConn({ ...dbConn, connectString: e.target.value })}
                    />
                  </div>
                )}
                {dialect === 'oracle' && (
                  <div className="form-control md:col-span-2">
                    <label className="label" htmlFor="db-owner">
                      <span className="label-text">Schema / Owner (optional — defaults to user)</span>
                    </label>
                    <input
                      id="db-owner"
                      className="input input-bordered"
                      value={dbConn.owner || ''}
                      onChange={e => setDbConn({ ...dbConn, owner: e.target.value })}
                    />
                  </div>
                )}

                {/* Postgres / MSSQL — schema override */}
                {(dialect === 'postgres' || dialect === 'mssql') && (
                  <div className="form-control md:col-span-2">
                    <label className="label" htmlFor="db-schema">
                      <span className="label-text">
                        Schema (optional — defaults to {dialect === 'postgres' ? 'public' : 'dbo'})
                      </span>
                    </label>
                    <input
                      id="db-schema"
                      className="input input-bordered"
                      value={dbConn.schema || ''}
                      onChange={e => setDbConn({ ...dbConn, schema: e.target.value })}
                    />
                  </div>
                )}

                {/* MSSQL TLS options */}
                {dialect === 'mssql' && (
                  <>
                    <div className="form-control">
                      <label className="label cursor-pointer">
                        <span className="label-text">Encrypt connection</span>
                        <input
                          type="checkbox"
                          className="toggle"
                          checked={dbConn.encrypt ?? true}
                          onChange={e => setDbConn({ ...dbConn, encrypt: e.target.checked })}
                        />
                      </label>
                    </div>
                    <div className="form-control">
                      <label className="label cursor-pointer">
                        <span className="label-text">Trust server certificate</span>
                        <input
                          type="checkbox"
                          className="toggle"
                          checked={dbConn.trustServerCertificate ?? false}
                          onChange={e =>
                            setDbConn({ ...dbConn, trustServerCertificate: e.target.checked })
                          }
                        />
                      </label>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="divider text-xs">Name Derivation</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-control">
              <label className="label">
                <span className="label-text">Strip Prefixes (comma-separated)</span>
              </label>
              <input
                className="input input-bordered input-sm"
                placeholder="tbl_, mv_"
                value={stripPrefixes}
                onChange={e => setStripPrefixes(e.target.value)}
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text">Strip Suffixes (comma-separated)</span>
              </label>
              <input
                className="input input-bordered input-sm"
                placeholder="_v2, _old"
                value={stripSuffixes}
                onChange={e => setStripSuffixes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              className="btn btn-primary"
              onClick={handlePreviewAndDiff}
              disabled={
                loading ||
                !targetService ||
                (sourceKind === 'sql' && !sqlText.trim()) ||
                (sourceKind === 'db' && !dbFormComplete)
              }
            >
              {loading && <span className="loading loading-spinner loading-sm" />}
              Preview Diff
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 2: Diff ─── */}
      {step === 'diff' && (
        <div className="space-y-4">
          <div className="stats shadow w-full">
            <div className="stat">
              <div className="stat-title">Added</div>
              <div className="stat-value text-success">{summary.added || 0}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Changed</div>
              <div className="stat-value text-warning">{summary.changed || 0}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Unchanged</div>
              <div className="stat-value">{summary.unchanged || 0}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Removed in source</div>
              <div className="stat-value text-error">{summary.removedInSource || 0}</div>
            </div>
          </div>

          <div className="text-sm text-base-content/70">
            "Removed in source" tables and model-only attributes are <strong>preserved</strong> —
            never deleted by this import.
          </div>

          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th></th>
                  <th>Entity</th>
                  <th>Physical Table</th>
                  <th>Status</th>
                  <th>Added</th>
                  <th>Changed</th>
                  <th>Unchanged</th>
                  <th>Removed</th>
                  <th>Model-only</th>
                </tr>
              </thead>
              <tbody>
                {diffs.map(d => {
                  const key = d.physicalTableName || d.name;
                  const isOpen = expandedEntity === key;
                  return (
                    <>
                      <tr key={key} className="cursor-pointer" onClick={() => setExpandedEntity(isOpen ? null : key)}>
                        <td>{isOpen ? '▾' : '▸'}</td>
                        <td className="font-medium">{d.name}</td>
                        <td className="font-mono text-xs">{d.physicalTableName || '—'}</td>
                        <td>{statusBadge(d.status)}</td>
                        <td>{d.counts.added || ''}</td>
                        <td>{d.counts.changed || ''}</td>
                        <td>{d.counts.unchanged || ''}</td>
                        <td>{d.counts.removedInSource || ''}</td>
                        <td>{d.counts.modelOnly || ''}</td>
                      </tr>
                      {isOpen && (
                        <tr key={`${key}-detail`}>
                          <td colSpan={9} className="bg-base-200">
                            <div className="p-2 space-y-1">
                              {d.attributes.length === 0 && (
                                <div className="text-xs text-base-content/60">No attribute changes.</div>
                              )}
                              {d.attributes.map(a => (
                                <div key={`${key}-${a.name}`} className="flex items-center gap-2 text-xs">
                                  {statusBadge(a.status)}
                                  <span className="font-mono">{a.name}</span>
                                  {a.changedFields && a.changedFields.length > 0 && (
                                    <span className="text-base-content/60">
                                      ({a.changedFields.join(', ')})
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between gap-2">
            <button className="btn btn-ghost" onClick={() => setStep('source')} disabled={loading}>
              ← Back
            </button>
            <button className="btn btn-primary" onClick={handleCommit} disabled={loading}>
              {loading && <span className="loading loading-spinner loading-sm" />}
              Commit Import
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 3: Result ─── */}
      {step === 'result' && commitResult && (
        <div className="space-y-4">
          <div className="alert alert-success">
            <span>
              Imported <strong>{commitResult.written}</strong> entities into{' '}
              <strong>{targetService}</strong>.
            </span>
          </div>
          <div className="stats shadow w-full">
            <div className="stat">
              <div className="stat-title">Created</div>
              <div className="stat-value text-success">{commitResult.added}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Merged</div>
              <div className="stat-value text-warning">{commitResult.merged}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Unchanged</div>
              <div className="stat-value">{commitResult.unchanged}</div>
            </div>
            <div className="stat">
              <div className="stat-title">Preserved (removed in source)</div>
              <div className="stat-value text-error">{commitResult.removedInSource}</div>
            </div>
          </div>

          {commitResult.errors.length > 0 && (
            <div className="alert alert-warning">
              <div>
                <div className="font-semibold">Errors:</div>
                <ul className="list-disc list-inside text-sm">
                  {commitResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button className="btn btn-primary" onClick={reset}>
              Start New Import
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
