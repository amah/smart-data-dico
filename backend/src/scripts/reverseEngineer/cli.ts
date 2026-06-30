/**
 * CLI surface of the reverse-engineer plugin.
 *
 *   tsx src/scripts/reverseEngineer/cli.ts --repo <path> --changelog <file> \
 *       [--src <java-src-dir>] [--out <dir>] [--no-jira]
 *
 * Thin wrapper over the same service the HTTP controller / UI use. With --src,
 * the JPA model is overlaid and drift is reported. Jira config is taken from env
 * (JIRA_BASE_URL / JIRA_TOKEN | JIRA_USER+JIRA_PASSWORD) or, if unset, from
 * ~/.dico-app/dico-app.json — unless --no-jira is passed.
 */
import fs from 'fs';
import { runReverseEngineer, runReverseEngineerMulti, type RepoSpec, type ProgressFn } from '../../services/reverseEngineer/reverseEngineerService.js';
import type { JiraConfig } from '../../services/reverseEngineer/jira.js';
import type { ConfluenceConfig } from '../../services/reverseEngineer/confluence.js';
import { getConfigSection } from '../../utils/appDir.js';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const repo = arg('repo');
const changelog = arg('changelog');
const src = arg('src');
const out = arg('out', '.dico-re');
const emitDico = arg('emit-dico');
const update = flag('update');
const synthesisMode = arg('synthesis'); // 'review' | 'direct'
const manifest = arg('manifest'); // JSON file: [{name,repoRoot,changelog,srcDir}] → multi-repo

if (!manifest && (!repo || !changelog)) {
  process.stderr.write('Usage: --repo <path> --changelog <file> [--src <dir>] [--out <dir>] [--emit-dico <dir>] [--synthesis review|direct] [--update] [--no-jira] [--no-confluence]\n   or: --manifest <repos.json>  (multi-repo: [{name,repoRoot,changelog,srcDir}])\n');
  process.exit(2);
}

function jiraConfig(): JiraConfig | undefined {
  if (flag('no-jira')) return undefined;
  if (process.env.JIRA_BASE_URL) {
    return {
      baseUrl: process.env.JIRA_BASE_URL,
      authType: process.env.JIRA_TOKEN ? 'token' : 'basic',
      token: process.env.JIRA_TOKEN,
      user: process.env.JIRA_USER,
      password: process.env.JIRA_PASSWORD,
      enabled: true,
    };
  }
  const saved = getConfigSection<JiraConfig>('jira');
  return saved?.enabled && saved.baseUrl ? saved : undefined;
}

function confluenceConfig(): ConfluenceConfig | undefined {
  if (flag('no-confluence')) return undefined;
  if (process.env.CONFLUENCE_BASE_URL) {
    return {
      baseUrl: process.env.CONFLUENCE_BASE_URL,
      authType: process.env.CONFLUENCE_TOKEN ? 'token' : 'basic',
      token: process.env.CONFLUENCE_TOKEN,
      user: process.env.CONFLUENCE_USER,
      password: process.env.CONFLUENCE_PASSWORD,
      spaceKey: process.env.CONFLUENCE_SPACE,
      enabled: true,
    };
  }
  const saved = getConfigSection<ConfluenceConfig>('confluence');
  return saved?.enabled && saved.baseUrl && saved.spaceKey ? saved : undefined;
}

const onProgress: ProgressFn = (e) => { process.stderr.write(`  · ${e.stage}/${e.status}${e.detail ? ' — ' + e.detail : ''}\n`); };
const shared = {
  jira: jiraConfig(),
  confluence: confluenceConfig(),
  out,
  emitDico,
  update,
  synthesis: synthesisMode === 'review' || synthesisMode === 'direct' ? { mode: synthesisMode as 'review' | 'direct' } : undefined,
  onProgress,
};

const { summary, drift, crossRepo } = manifest
  ? await runReverseEngineerMulti({ repos: JSON.parse(fs.readFileSync(manifest, 'utf-8')) as RepoSpec[], ...shared })
  : await runReverseEngineer({ repoRoot: repo!, changelog: changelog!, srcDir: src, ...shared });

const lines = [
  '',
  `  Reverse-engineer — ${manifest ? `multi-repo (${summary.repos?.join(', ')})` : repo}`,
  `  changeSets:  ${summary.changeSets}`,
  `  elements:    ${summary.elements}`,
  `  events:      ${summary.events}`,
  `  w/ commit:   ${summary.withCommit}/${summary.changeSets}`,
  `  jpa files:   ${summary.jpaFiles}`,
  `  drift:       ${summary.driftFindings}`,
  `  jira issues: ${summary.jiraIssues}`,
  `  confluence:  ${summary.confluencePages} pages`,
  `  tickets:     ${summary.tickets.join(', ') || '(none)'}`,
  `  store:       ${summary.storeDir}`,
  `  dico project:${summary.dicoProject ? ' ' + summary.dicoProject : ' (not emitted)'}`,
  `  synthesis:   ${summary.synthesisDir ? summary.synthesisDir : '(not generated)'}`,
];
if (crossRepo) {
  lines.push(
    '',
    `  Cross-repo (${crossRepo.repos.join(', ')}):`,
    `    shared entities:   ${crossRepo.sharedEntities.length}`,
    `    cross-repo rels:   ${crossRepo.crossRepoRelationships.length}`,
    `    conflicts:         ${crossRepo.conflicts.length}`,
    `    dangling refs:     ${crossRepo.danglingReferences.length}`,
  );
  for (const r of crossRepo.crossRepoRelationships) lines.push(`    • ${r.from} → ${r.to}  (${r.fromRepos.join(',')} → ${r.toRepos.join(',')})`);
  for (const d of crossRepo.danglingReferences) lines.push(`    • dangling: ${d.relationship.replace('relationship:', '')} → ${d.target} (not found in any repo)`);
}
if (drift.length) {
  lines.push('', '  Drift findings:');
  for (const d of drift) lines.push(`    • [${d.kind}] ${d.element} — ${d.detail}`);
}
process.stdout.write(lines.join('\n') + '\n\n');
