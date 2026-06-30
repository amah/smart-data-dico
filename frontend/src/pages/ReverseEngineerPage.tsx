/**
 * Reverse-engineer page (front side of the plugin).
 *
 * Phase-1: point at a repo + Liquibase changelog, run extraction, and inspect
 * the resulting CIR (entities/attributes/relationships/constraints) with their
 * commit/ticket provenance. Calls POST /api/reverse-engineer/run via the service.
 */
import { useState } from 'react';
import { PageHeader, Field, Input, Button, EmptyState, Chip, Icon } from '../components/ui';
import { reverseEngineerApi, type ReverseEngineerResult, type ReProgressEvent } from '../services/api';

// Ordered pipeline stages for the live analysis panel.
const STAGES: Array<[string, string]> = [
  ['liquibase', 'Parse Liquibase'],
  ['correlate', 'Correlate git / tickets'],
  ['jpa', 'Scan JPA'],
  ['drift', 'Compute drift'],
  ['jira', 'Enrich from Jira'],
  ['confluence', 'Dump Confluence'],
  ['emit', 'Emit dico project'],
  ['synthesize', 'Build synthesis package'],
];

export default function ReverseEngineerPage() {
  const [repoRoot, setRepoRoot] = useState('');
  const [changelog, setChangelog] = useState('db/db.changelog-master.yaml');
  const [srcDir, setSrcDir] = useState('');
  const [out, setOut] = useState('');
  const [emitDico, setEmitDico] = useState('');
  const [synthesis, setSynthesis] = useState<'' | 'review' | 'direct'>('');
  const [enrich, setEnrich] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReverseEngineerResult | null>(null);
  const [progress, setProgress] = useState<Record<string, { status: string; detail?: string }>>({});

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress({});
    try {
      const r = await reverseEngineerApi.runStream(
        { repoRoot, changelog, srcDir: srcDir || undefined, out: out || undefined, emitDico: emitDico || undefined, synthesis: synthesis || undefined, enrich },
        (e: ReProgressEvent) => setProgress((p) => ({ ...p, [e.stage]: { status: e.status, detail: e.detail } })),
      );
      setResult(r);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message ?? 'Extraction failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PageHeader
        breadcrumb="Reverse-engineer"
        description="Mine a repository's Liquibase changelog + git history into data-dictionary elements, each traced to the commit and ticket that introduced it."
      />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Repository path">
          <Input value={repoRoot} onChange={(e) => setRepoRoot(e.target.value)} placeholder="/path/to/repo" width={320} />
        </Field>
        <Field label="Changelog (repo-relative)">
          <Input value={changelog} onChange={(e) => setChangelog(e.target.value)} width={300} />
        </Field>
        <Field label="Java source dir (optional → drift)">
          <Input value={srcDir} onChange={(e) => setSrcDir(e.target.value)} placeholder="src/main/java" width={220} />
        </Field>
        <Field label="Output store (optional)">
          <Input value={out} onChange={(e) => setOut(e.target.value)} placeholder=".dico-re" width={160} />
        </Field>
        <Field label="Emit dico project to (optional)">
          <Input value={emitDico} onChange={(e) => setEmitDico(e.target.value)} placeholder="/path/to/new-project" width={200} />
        </Field>
        <Field label="AI synthesis package">
          <select
            value={synthesis}
            onChange={(e) => setSynthesis(e.target.value as '' | 'review' | 'direct')}
            style={{ height: 32, borderRadius: 6, padding: '0 8px' }}
          >
            <option value="">none</option>
            <option value="review">review (markdown for approval)</option>
            <option value="direct">direct (agent edits dico)</option>
          </select>
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} />
          Enrich with Jira
        </label>
        <Button variant="primary" disabled={busy || !repoRoot || !changelog} onClick={run}>
          {busy ? 'Running…' : 'Run extraction'}
        </Button>
      </div>

      {error && <div role="alert"><Chip tone="danger">{error}</Chip></div>}

      {(busy || Object.keys(progress).length > 0) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 12, borderRadius: 8, background: 'var(--surface-2, rgba(127,127,127,0.06))' }}>
          <strong style={{ fontSize: 13 }}>Analysis progress</strong>
          {STAGES.filter(([key]) => progress[key]).map(([key, label]) => {
            const st = progress[key];
            const done = st.status === 'done';
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <Icon name={done ? 'check' : 'dot'} size={13} />
                <span style={{ minWidth: 170 }}>{label}</span>
                <span style={{ opacity: 0.7 }}>{st.detail ?? (done ? 'done' : 'running…')}</span>
              </div>
            );
          })}
          {busy && !progress['done'] && <div style={{ fontSize: 12, opacity: 0.6 }}>Working…</div>}
        </div>
      )}

      {!result && !busy && (
        <EmptyState title="No extraction yet" message="Point at a repo with a Liquibase changelog and run." />
      )}

      {result && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Chip>{result.summary.elements} elements</Chip>
            <Chip>{result.summary.events} events</Chip>
            <Chip>{result.summary.changeSets} changeSets</Chip>
            <Chip>{result.summary.withCommit}/{result.summary.changeSets} commit-linked</Chip>
            {result.summary.jpaFiles > 0 && <Chip>{result.summary.jpaFiles} JPA files</Chip>}
            {result.summary.driftFindings > 0 && <Chip tone="warning">{result.summary.driftFindings} drift</Chip>}
            {result.summary.jiraIssues > 0 && <Chip tone="success">{result.summary.jiraIssues} Jira</Chip>}
            {result.summary.confluencePages > 0 && <Chip tone="success">{result.summary.confluencePages} Confluence</Chip>}
            {result.summary.tickets.map((t) => (
              <Chip key={t} tone="info">{t}</Chip>
            ))}
          </div>

          {result.drift.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong style={{ fontSize: 13 }}>Drift (JPA ⇄ DB)</strong>
              {result.drift.map((d, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <Chip tone="warning">{d.kind}</Chip>
                  <span style={{ fontFamily: 'monospace' }}>{d.element.replace(/^[a-z]+:/, '')}</span>
                  <span style={{ opacity: 0.75 }}>{d.detail}</span>
                </div>
              ))}
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Kind</th>
                <th style={{ padding: '6px 8px' }}>Element</th>
                <th style={{ padding: '6px 8px' }}>Ticket</th>
                <th style={{ padding: '6px 8px' }}>Type / facts</th>
                <th style={{ padding: '6px 8px' }}>Conf.</th>
              </tr>
            </thead>
            <tbody>
              {result.elements.map((el) => (
                <tr key={el.id} style={{ borderTop: '1px solid var(--border-subtle, transparent)' }}>
                  <td style={{ padding: '6px 8px' }}><Chip>{el.kind}</Chip></td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{el.id.replace(/^[a-z]+:/, '')}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {el.provenance.find((p) => p.ticket)?.ticket
                      ? <Chip tone="info">{el.provenance.find((p) => p.ticket)?.ticket}</Chip>
                      : '—'}
                  </td>
                  <td style={{ padding: '6px 8px' }}>{String(el.facts.dataType ?? el.facts.cardinality ?? el.facts.constraintType ?? '')}</td>
                  <td style={{ padding: '6px 8px' }}>{el.confidence ?? 1}{el.flags?.length ? ` ⚠` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.summary.storeDir && (
            <div style={{ fontSize: 12, opacity: 0.7 }}>CIR store written to {result.summary.storeDir}</div>
          )}
          {result.summary.dicoProject && (
            <div style={{ fontSize: 12, opacity: 0.7 }}>smart-data-dico project emitted to {result.summary.dicoProject}</div>
          )}
          {result.summary.synthesisDir && (
            <div style={{ fontSize: 12, opacity: 0.7 }}>AI synthesis package at {result.summary.synthesisDir} (briefs + AGENT.md)</div>
          )}
        </>
      )}
    </div>
  );
}
