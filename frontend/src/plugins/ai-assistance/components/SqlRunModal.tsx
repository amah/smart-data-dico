import { useCallback, useEffect, useRef, useState } from 'react';
import { sqlRunApi, type SqlDialect, type SqlRunChunk } from '../../../services/api';

/**
 * Runs a generated SQL query against a package's database and shows the result.
 * Flow: ensure a connection (prompt for credentials if needed) → run →
 *   - success → chunked results grid (fetch more on scroll, SQL-Developer style)
 *   - DB error → auto-repair loop (cap 3): ask the AI to fix it, re-run.
 */

const REPAIR_CAP = 3;
const CHUNK = 100;

type Phase = 'connect' | 'running' | 'results' | 'error';
interface Attempt { sql: string; error: string }

function dialectFields(d: SqlDialect): { key: string; label: string; placeholder?: string }[] {
  if (d === 'oracle') return [{ key: 'connectString', label: 'Connect string', placeholder: 'host:1521/service' }];
  if (d === 'mssql') return [{ key: 'server', label: 'Server' }, { key: 'port', label: 'Port' }, { key: 'database', label: 'Database' }];
  return [{ key: 'host', label: 'Host' }, { key: 'port', label: 'Port' }, { key: 'database', label: 'Database' }];
}

function toCsv(columns: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}

function errOf(e: any): { status?: number; code?: string; message: string } {
  const r = e?.response;
  return { status: r?.status, code: r?.data?.code, message: r?.data?.error || r?.data?.message || e?.message || 'Request failed' };
}

export default function SqlRunModal({ open, sql, packageName, onClose }: {
  open: boolean; sql: string; packageName: string; onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('running');
  const [busy, setBusy] = useState(false);
  const [currentSql, setCurrentSql] = useState(sql);
  const [chunk, setChunk] = useState<SqlRunChunk | null>(null);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [trail, setTrail] = useState<Attempt[]>([]);
  const [copied, setCopied] = useState(false);

  // connect form
  const [dialect, setDialect] = useState<SqlDialect>('postgres');
  const [conn, setConn] = useState<Record<string, string>>({});
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');

  const gridRef = useRef<HTMLDivElement>(null);
  const resultIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  // Run + auto-repair loop. Returns when it lands on results or exhausts repairs.
  const runWithRepair = useCallback(async (initialSql: string) => {
    setBusy(true); setPhase('running'); setErrorMsg(''); setTrail([]); setRows([]);
    let attemptSql = initialSql;
    const attempts: Attempt[] = [];
    for (let i = 0; i <= REPAIR_CAP; i++) {
      try {
        const res = await sqlRunApi.run(packageName, attemptSql, CHUNK);
        resultIdRef.current = res.resultId;
        setChunk(res); setRows(res.rows); setCurrentSql(attemptSql); setTrail(attempts);
        setPhase('results'); setBusy(false);
        return;
      } catch (e: any) {
        const { status, code, message } = errOf(e);
        if (code === 'no-connection' || status === 409) { setPhase('connect'); setBusy(false); return; }
        // a real DB / guard error → try to repair, unless we're out of budget
        attempts.push({ sql: attemptSql, error: message });
        if (i >= REPAIR_CAP) { setErrorMsg(message); setTrail(attempts); setPhase('error'); setBusy(false); return; }
        try {
          const fixed = await sqlRunApi.repair(packageName, attemptSql, message);
          if (!fixed?.sql || fixed.sql.trim() === attemptSql.trim()) { setErrorMsg(message); setTrail(attempts); setPhase('error'); setBusy(false); return; }
          attemptSql = fixed.sql;
          setTrail([...attempts]); // show progress
        } catch { setErrorMsg(message); setTrail(attempts); setPhase('error'); setBusy(false); return; }
      }
    }
  }, [packageName]);

  // On open: prefill connect form from physical config, then check connection.
  useEffect(() => {
    if (!open || startedRef.current) return;
    startedRef.current = true;
    setCurrentSql(sql);
    (async () => {
      const [phys, existing] = await Promise.all([
        sqlRunApi.getPhysicalConfig(packageName).catch(() => null),
        sqlRunApi.getConnection(packageName).catch(() => null),
      ]);
      if (phys?.dialect) setDialect(phys.dialect);
      if (phys?.connection) setConn(Object.fromEntries(Object.entries(phys.connection).map(([k, v]) => [k, String(v ?? '')])));
      if (existing) { setUser(existing.user); await runWithRepair(sql); }
      else setPhase('connect');
    })();
  }, [open, sql, packageName, runWithRepair]);

  // reset when closed so the next open starts fresh
  useEffect(() => {
    if (open) return;
    startedRef.current = false;
    if (resultIdRef.current) { sqlRunApi.close(resultIdRef.current).catch(() => {}); resultIdRef.current = null; }
    setPhase('running'); setChunk(null); setRows([]); setErrorMsg(''); setTrail([]); setPassword('');
  }, [open]);

  const doConnect = async () => {
    setBusy(true); setErrorMsg('');
    try {
      await sqlRunApi.connect({ packageName, dialect, connection: conn, user, password });
      await runWithRepair(currentSql);
    } catch (e: any) {
      setErrorMsg(errOf(e).message); setBusy(false);
    }
  };

  const onScroll = async () => {
    const el = gridRef.current;
    if (!el || loadingMore || !chunk || chunk.done || !resultIdRef.current) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      setLoadingMore(true);
      try {
        const next = await sqlRunApi.fetchMore(resultIdRef.current, CHUNK);
        setRows(prev => [...prev, ...next.rows]);
        setChunk(c => (c ? { ...c, done: next.done } : c));
      } catch (e: any) { setChunk(c => (c ? { ...c, done: true } : c)); setErrorMsg(errOf(e).message); }
      finally { setLoadingMore(false); }
    }
  };

  const copyCsv = async () => {
    if (!chunk) return;
    try { await navigator.clipboard.writeText(toCsv(chunk.columns, rows)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };

  if (!open) return null;

  return (
    <div className="modal modal-open" data-testid="sql-run-modal">
      <div className="modal-box max-w-5xl w-[min(90vw,72rem)] max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">Run SQL · <span className="font-mono text-primary/80">{packageName}</span></h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <pre className="text-[11px] bg-base-200/50 rounded p-2 mb-2 overflow-x-auto max-h-24">{currentSql}</pre>

        {phase === 'connect' && (
          <div className="space-y-2" data-testid="sql-connect-form">
            <p className="text-xs text-base-content/60">Connect to the <b>{packageName}</b> database (read-only). Credentials are cached for this session only — never stored.</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="form-control"><span className="label-text text-xs">Dialect</span>
                <select className="select select-sm select-bordered" value={dialect} onChange={e => setDialect(e.target.value as SqlDialect)}>
                  <option value="postgres">postgres</option><option value="mysql">mysql</option><option value="mssql">mssql</option><option value="oracle">oracle</option>
                </select>
              </label>
              {dialectFields(dialect).map(f => (
                <label key={f.key} className="form-control"><span className="label-text text-xs">{f.label}</span>
                  <input className="input input-sm input-bordered" placeholder={f.placeholder} value={conn[f.key] ?? ''} onChange={e => setConn(c => ({ ...c, [f.key]: e.target.value }))} />
                </label>
              ))}
              <label className="form-control"><span className="label-text text-xs">User</span>
                <input className="input input-sm input-bordered" value={user} onChange={e => setUser(e.target.value)} autoComplete="off" />
              </label>
              <label className="form-control"><span className="label-text text-xs">Password</span>
                <input type="password" className="input input-sm input-bordered" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" />
              </label>
            </div>
            {errorMsg && <div className="text-error text-xs" data-testid="sql-connect-error">{errorMsg}</div>}
            <div className="flex justify-end gap-2">
              <button className="btn btn-sm" onClick={onClose}>Cancel</button>
              <button className="btn btn-sm btn-primary" onClick={doConnect} disabled={busy || !user}>{busy ? 'Connecting…' : 'Connect & run'}</button>
            </div>
          </div>
        )}

        {phase === 'running' && (
          <div className="flex items-center gap-2 text-sm py-6 justify-center text-base-content/70" data-testid="sql-running">
            <span className="loading loading-spinner loading-sm" /> Running query…
            {trail.length > 0 && <span className="text-xs">(repair attempt {trail.length})</span>}
          </div>
        )}

        {phase === 'results' && chunk && (
          <>
            <div className="flex items-center gap-2 mb-1 text-xs text-base-content/60">
              <span data-testid="sql-rowcount">{rows.length} row{rows.length === 1 ? '' : 's'}{chunk.done ? '' : '+'}</span>
              <span>· {chunk.columns.length} columns</span>
              {trail.length > 0 && <span className="badge badge-xs badge-warning badge-outline">auto-repaired ×{trail.length}</span>}
              <span className="flex-1" />
              <button className="btn btn-xs btn-ghost" onClick={copyCsv}>{copied ? 'Copied!' : 'Copy CSV'}</button>
            </div>
            <div ref={gridRef} onScroll={onScroll} className="overflow-auto border border-base-300 rounded flex-1" data-testid="sql-results-grid">
              <table className="table table-xs table-pin-rows">
                <thead><tr>{chunk.columns.map((c, i) => <th key={i} className="font-mono">{c}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r, ri) => (
                    <tr key={ri}>{chunk.columns.map((_, ci) => <td key={ci} className="font-mono whitespace-pre">{r[ci] == null ? <span className="text-base-content/30">NULL</span> : String(r[ci])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {loadingMore && <div className="text-center text-xs py-2 text-base-content/50"><span className="loading loading-spinner loading-xs" /> loading more…</div>}
              {chunk.done && <div className="text-center text-[10px] py-1 text-base-content/40">— end of results —</div>}
            </div>
          </>
        )}

        {phase === 'error' && (
          <div className="space-y-2" data-testid="sql-error">
            <div className="text-error text-sm">Query failed{trail.length > 1 ? ` after ${trail.length} attempts` : ''}:</div>
            <pre className="text-[11px] bg-error/10 text-error rounded p-2 overflow-x-auto">{errorMsg}</pre>
            {trail.length > 0 && (
              <details className="text-xs"><summary className="cursor-pointer text-base-content/60">repair trail ({trail.length})</summary>
                <ol className="list-decimal ml-5 mt-1 space-y-1">
                  {trail.map((a, i) => <li key={i}><pre className="text-[10px] whitespace-pre-wrap">{a.sql}</pre><span className="text-error/80">→ {a.error}</span></li>)}
                </ol>
              </details>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn btn-sm" onClick={onClose}>Close</button>
              <button className="btn btn-sm btn-primary" onClick={() => runWithRepair(currentSql)} disabled={busy}>Retry</button>
            </div>
          </div>
        )}
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}
