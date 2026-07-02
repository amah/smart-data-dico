import { useCallback, useEffect, useRef, useState } from 'react';
import { sqlRunApi, type SqlDialect, type SqlRunChunk, type SqlSecretCapabilities } from '../../../services/api';

/**
 * Runs a generated SQL query against a package's database and shows the result.
 * Flow: ensure a connection (prompt for credentials if needed) → run →
 *   - success → chunked results grid (fetch more on scroll, SQL-Developer style)
 *   - syntax / DB error → surface the failed SQL + error back to the AI chat
 *     thread (`ai-chat:sql-error`) so the agent explains it and proposes a fix.
 */

const CHUNK = 100;

type Phase = 'connect' | 'running' | 'results' | 'error';

/**
 * Hand a failed query + its DB error to the AI chat so the agent can analyse it
 * and reply with a corrected query. Shared channel: SqlRunModal and the
 * standalone SQL Console (#205) both dispatch this event; AIChatPanel listens.
 */
function sendSqlErrorToChat(sql: string, error: string, packageName: string): void {
  window.dispatchEvent(new CustomEvent('ai-chat:sql-error', { detail: { sql, error, packageName } }));
}

function dialectFields(d: SqlDialect): { key: string; label: string; placeholder?: string }[] {
  if (d === 'sqlite') return [{ key: 'file', label: 'Database file', placeholder: '/path/to/db.sqlite' }];
  if (d === 'oracle') return [{ key: 'connectString', label: 'Connect string', placeholder: 'host:1521/service' }];
  if (d === 'mssql') return [{ key: 'server', label: 'Server' }, { key: 'port', label: 'Port' }, { key: 'database', label: 'Database' }];
  return [{ key: 'host', label: 'Host' }, { key: 'port', label: 'Port' }, { key: 'database', label: 'Database' }];
}

// SQLite is a local file — no user/password needed.
const needsCredentials = (d: SqlDialect) => d !== 'sqlite';

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
  const [sentToChat, setSentToChat] = useState(false);
  const [copied, setCopied] = useState(false);

  // connect form
  const [dialect, setDialect] = useState<SqlDialect>('postgres');
  const [conn, setConn] = useState<Record<string, string>>({});
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  // password persistence (secret store)
  const [caps, setCaps] = useState<SqlSecretCapabilities | null>(null);
  const [remember, setRemember] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const resultIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  // Run once. On a syntax/DB error, hand the failure to the AI chat thread so the
  // agent can explain it and reply with a corrected query (which renders its own
  // ▶ Run button). No silent retries — the fix happens conversationally.
  const runQuery = useCallback(async (runSql: string) => {
    setBusy(true); setPhase('running'); setErrorMsg(''); setSentToChat(false); setRows([]);
    try {
      const res = await sqlRunApi.run(packageName, runSql, CHUNK);
      resultIdRef.current = res.resultId;
      setChunk(res); setRows(res.rows); setCurrentSql(runSql);
      setPhase('results'); setBusy(false);
    } catch (e: any) {
      const { status, code, message } = errOf(e);
      if (code === 'no-connection' || status === 409) { setPhase('connect'); setBusy(false); return; }
      // syntax / guard / DB error → surface it to the assistant for analysis + fix
      setCurrentSql(runSql); setErrorMsg(message);
      sendSqlErrorToChat(runSql, message, packageName);
      setSentToChat(true); setPhase('error'); setBusy(false);
    }
  }, [packageName]);

  // On open: prefill connect form from physical config, then check connection.
  useEffect(() => {
    if (!open || startedRef.current) return;
    startedRef.current = true;
    setCurrentSql(sql);
    (async () => {
      const [phys, existing, capabilities] = await Promise.all([
        sqlRunApi.getPhysicalConfig(packageName).catch(() => null),
        sqlRunApi.getConnection(packageName).catch(() => null),
        sqlRunApi.secretCapabilities(),
      ]);
      setCaps(capabilities);
      const dial = phys?.dialect ?? 'postgres';
      const connObj = phys?.connection ? Object.fromEntries(Object.entries(phys.connection).map(([k, v]) => [k, String(v ?? '')])) : {};
      if (phys?.dialect) setDialect(dial);
      if (phys?.connection) setConn(connObj);
      if (existing) { setUser(existing.user); await runQuery(sql); return; }
      setPhase('connect');
    })();
  }, [open, sql, packageName, runQuery]);

  // reset when closed so the next open starts fresh
  useEffect(() => {
    if (open) return;
    startedRef.current = false;
    if (resultIdRef.current) { sqlRunApi.close(resultIdRef.current).catch(() => {}); resultIdRef.current = null; }
    setPhase('running'); setChunk(null); setRows([]); setErrorMsg(''); setSentToChat(false); setPassword('');
    setRemember(false); setHasSaved(false);
  }, [open]);

  // Whether a password is already saved for the current (package, connection, user)
  // identity — drives the "saved password will be used" hint + Forget button.
  useEffect(() => {
    if (!open || phase !== 'connect' || dialect === 'sqlite' || !user) { setHasSaved(false); return; }
    let cancelled = false;
    sqlRunApi.secretStatus({ packageName, dialect, connection: conn, user }).then(s => { if (!cancelled) setHasSaved(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, phase, dialect, user, conn, packageName]);

  const doConnect = async () => {
    setBusy(true); setErrorMsg('');
    try {
      await sqlRunApi.connect({ packageName, dialect, connection: conn, user, password, remember });
      await runQuery(currentSql);
    } catch (e: any) {
      setErrorMsg(errOf(e).message); setBusy(false);
    }
  };

  const forgetPassword = async () => {
    try { await sqlRunApi.forgetSecret(packageName); setHasSaved(false); setRemember(false); } catch { /* best-effort */ }
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
            <p className="text-xs text-base-content/60">Connect to the <b>{packageName}</b> database (read-only). Credentials are cached in memory for this session; the password is only stored if you tick <i>Remember</i> below.</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="form-control"><span className="label-text text-xs">Dialect</span>
                <select className="select select-sm select-bordered" value={dialect} onChange={e => setDialect(e.target.value as SqlDialect)}>
                  <option value="postgres">postgres</option><option value="mysql">mysql</option><option value="mssql">mssql</option><option value="oracle">oracle</option><option value="sqlite">sqlite</option>
                </select>
              </label>
              {dialectFields(dialect).map(f => (
                <label key={f.key} className="form-control"><span className="label-text text-xs">{f.label}</span>
                  <input className="input input-sm input-bordered" placeholder={f.placeholder} value={conn[f.key] ?? ''} onChange={e => setConn(c => ({ ...c, [f.key]: e.target.value }))} />
                </label>
              ))}
              {needsCredentials(dialect) && (<>
                <label className="form-control"><span className="label-text text-xs">User</span>
                  <input className="input input-sm input-bordered" value={user} onChange={e => setUser(e.target.value)} autoComplete="off" />
                </label>
                <label className="form-control"><span className="label-text text-xs">Password</span>
                  <input type="password" className="input input-sm input-bordered" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" placeholder={hasSaved ? 'leave blank to use saved password' : undefined} />
                </label>
              </>)}
            </div>
            {needsCredentials(dialect) && (
              <div className="flex items-center gap-2 text-xs" data-testid="sql-remember-row">
                <label className="flex items-center gap-1.5 cursor-pointer" title={caps && !caps.canStore ? caps.reason : undefined}>
                  <input type="checkbox" className="checkbox checkbox-xs" checked={remember} disabled={!caps?.canStore} onChange={e => setRemember(e.target.checked)} />
                  <span className={caps?.canStore ? '' : 'opacity-50'}>Remember password on this machine</span>
                </label>
                {caps?.canStore && caps.provider && <span className="text-base-content/40">via {caps.provider}</span>}
                {!caps?.canStore && <span className="text-warning/80">unavailable here</span>}
                <span className="flex-1" />
                {hasSaved && <button type="button" className="btn btn-xs btn-ghost text-error" onClick={forgetPassword} data-testid="sql-forget">Forget saved password</button>}
              </div>
            )}
            {errorMsg && <div className="text-error text-xs" data-testid="sql-connect-error">{errorMsg}</div>}
            <div className="flex justify-end gap-2">
              <button className="btn btn-sm" onClick={onClose}>Cancel</button>
              <button className="btn btn-sm btn-primary" onClick={doConnect} disabled={busy || (needsCredentials(dialect) && !user)}>{busy ? 'Connecting…' : 'Connect & run'}</button>
            </div>
          </div>
        )}

        {phase === 'running' && (
          <div className="flex items-center gap-2 text-sm py-6 justify-center text-base-content/70" data-testid="sql-running">
            <span className="loading loading-spinner loading-sm" /> Running query…
          </div>
        )}

        {phase === 'results' && chunk && (
          <>
            <div className="flex items-center gap-2 mb-1 text-xs text-base-content/60">
              <span data-testid="sql-rowcount">{rows.length} row{rows.length === 1 ? '' : 's'}{chunk.done ? '' : '+'}</span>
              <span>· {chunk.columns.length} columns</span>
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
            <div className="text-error text-sm">Query failed:</div>
            <pre className="text-[11px] bg-error/10 text-error rounded p-2 overflow-x-auto">{errorMsg}</pre>
            {sentToChat && (
              <div className="text-xs text-base-content/70 flex items-start gap-1" data-testid="sql-sent-to-chat">
                <span>↗</span>
                <span>Sent to the assistant — it will explain the error and propose a corrected query in the chat. Close this dialog to view it.</span>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn btn-sm" onClick={() => runQuery(currentSql)} disabled={busy}>Retry</button>
              <button className="btn btn-sm btn-primary" onClick={onClose} data-testid="sql-view-in-chat">View in chat</button>
            </div>
          </div>
        )}
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}
