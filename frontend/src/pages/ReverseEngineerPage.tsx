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
  ['crossrepo', 'Resolve cross-repo'],
  ['jira', 'Enrich from Jira'],
  ['confluence', 'Dump Confluence'],
  ['emit', 'Emit dico project'],
  ['synthesize', 'Build synthesis package'],
];

export default function ReverseEngineerPage() {
  const [multi, setMulti] = useState(false);
  const [mavenRoot, setMavenRoot] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);
  const [reposJson, setReposJson] = useState(
    '[\n  { "name": "svc-a", "repoRoot": "/path/to/svc-a", "changelog": "db/db.changelog-master.yaml", "srcDir": "src/main/java" },\n  { "name": "svc-b", "repoRoot": "/path/to/svc-b", "changelog": "db/db.changelog-master.yaml" }\n]',
  );
  const [repoRoot, setRepoRoot] = useState('');
  const [changelog, setChangelog] = useState('db/db.changelog-master.yaml');
  const [srcDir, setSrcDir] = useState('');
  const [out, setOut] = useState('');
  const [emitDico, setEmitDico] = useState('');
  const [update, setUpdate] = useState(false);
  const [synthesis, setSynthesis] = useState<'' | 'review' | 'direct'>('');
  const [enrich, setEnrich] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReverseEngineerResult | null>(null);
  const [progress, setProgress] = useState<Record<string, { status: string; detail?: string }>>({});

  const detect = async () => {
    if (!mavenRoot.trim()) return;
    setDetecting(true);
    setDetectMsg(null);
    try {
      const r = await reverseEngineerApi.detectMaven(mavenRoot);
      setReposJson(JSON.stringify(r.plan, null, 2));
      setDetectMsg(
        r.plan.length
          ? `Detected ${r.plan.length} module(s) across ${r.modules} pom(s). Review below, then Run.${r.warnings.length ? ` ⚠ ${r.warnings.length} warning(s).` : ''}`
          : (r.warnings[0] ?? 'No Liquibase changelogs detected.'),
      );
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string; message?: string } } };
      setDetectMsg(err?.response?.data?.error ?? err?.response?.data?.message ?? 'Detection failed');
    } finally {
      setDetecting(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setProgress({});
    const common = { out: out || undefined, emitDico: emitDico || undefined, update, synthesis: synthesis || undefined, enrich };
    let input;
    if (multi) {
      try {
        input = { repos: JSON.parse(reposJson), ...common };
      } catch {
        setError('Multi-repo: the repos JSON is not valid.');
        setBusy(false);
        return;
      }
    } else {
      input = { repoRoot, changelog, srcDir: srcDir || undefined, ...common };
    }
    try {
      const r = await reverseEngineerApi.runStream(
        input,
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

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }} title="Mine several repos at once and analyse cross-repo relationships (a FK whose referenced table lives in another repo).">
        <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
        Multi-repo (cross-repo analysis)
      </label>

      {multi && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Maven project root → auto-detect Liquibase changelogs">
            <Input value={mavenRoot} onChange={(e) => setMavenRoot(e.target.value)} placeholder="/path/to/maven-project" width={340} />
          </Field>
          <Button variant="secondary" disabled={detecting || !mavenRoot.trim()} onClick={detect}>
            {detecting ? 'Detecting…' : 'Detect changelogs'}
          </Button>
          {detectMsg && <span style={{ fontSize: 12, opacity: 0.75 }}>{detectMsg}</span>}
        </div>
      )}

      {multi && (
        <Field label="Repos (JSON: name, repoRoot, changelog, srcDir) — edit or auto-fill via Detect">
          <textarea
            value={reposJson}
            onChange={(e) => setReposJson(e.target.value)}
            spellCheck={false}
            style={{ width: '100%', minHeight: 130, fontFamily: 'monospace', fontSize: 12, borderRadius: 6, padding: 8 }}
          />
        </Field>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {!multi && (
          <>
            <Field label="Repository path">
              <Input value={repoRoot} onChange={(e) => setRepoRoot(e.target.value)} placeholder="/path/to/repo" width={320} />
            </Field>
            <Field label="Changelog (repo-relative)">
              <Input value={changelog} onChange={(e) => setChangelog(e.target.value)} width={300} />
            </Field>
            <Field label="Java source dir (optional → drift)">
              <Input value={srcDir} onChange={(e) => setSrcDir(e.target.value)} placeholder="src/main/java" width={220} />
            </Field>
          </>
        )}
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }} title="Merge into the existing project at the emit path: reuse UUIDs, keep descriptions/rules, refresh structure.">
          <input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
          Update existing (merge)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} />
          Enrich with Jira
        </label>
        <Button variant="primary" disabled={busy || (multi ? !reposJson.trim() : !repoRoot || !changelog)} onClick={run}>
          {busy ? 'Running…' : 'Run extraction'}
        </Button>
      </div>

      {error && <div role="alert"><Chip tone="danger">{error}</Chip></div>}

      {result && result.warnings.length > 0 && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <strong style={{ fontSize: 13 }}>⚠ Warnings ({result.warnings.length})</strong>
          {result.warnings.map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <Chip tone="warning">warning</Chip>
              <span style={{ opacity: 0.8 }}>{w}</span>
            </div>
          ))}
        </div>
      )}

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
            {result.summary.repos && <Chip tone="info">{result.summary.repos.length} repos</Chip>}
            {(result.summary.crossRepoRelationships ?? 0) > 0 && <Chip tone="info">{result.summary.crossRepoRelationships} cross-repo rels</Chip>}
            {(result.summary.danglingReferences ?? 0) > 0 && <Chip tone="warning">{result.summary.danglingReferences} dangling</Chip>}
            {(result.summary.conflicts ?? 0) > 0 && <Chip tone="danger">{result.summary.conflicts} conflicts</Chip>}
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

          {result.crossRepo && (result.crossRepo.crossRepoRelationships.length > 0 || result.crossRepo.danglingReferences.length > 0 || result.crossRepo.conflicts.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong style={{ fontSize: 13 }}>Cross-repo analysis</strong>
              {result.crossRepo.crossRepoRelationships.map((r, i) => (
                <div key={`x${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <Chip tone="info">cross-repo</Chip>
                  <span style={{ fontFamily: 'monospace' }}>{r.from} → {r.to}</span>
                  <span style={{ opacity: 0.75 }}>{r.fromRepos.join(',')} → {r.toRepos.join(',')}</span>
                </div>
              ))}
              {result.crossRepo.danglingReferences.map((d, i) => (
                <div key={`d${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <Chip tone="warning">dangling</Chip>
                  <span style={{ fontFamily: 'monospace' }}>{d.relationship.replace(/^relationship:/, '')}</span>
                  <span style={{ opacity: 0.75 }}>{d.target} not found in any repo</span>
                </div>
              ))}
              {result.crossRepo.conflicts.map((c, i) => (
                <div key={`c${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                  <Chip tone="danger">conflict</Chip>
                  <span style={{ fontFamily: 'monospace' }}>{c.element.replace(/^[a-z]+:/, '')}</span>
                  <span style={{ opacity: 0.75 }}>{c.detail} ({c.repos.join(', ')})</span>
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
