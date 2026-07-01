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
import { detectMaven, detectMavenStream, detectionToPlan } from '../../services/reverseEngineer/mavenDetect.js';
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
const detectRoot = arg('detect'); // print detected Liquibase changelogs for a Maven project, then exit
const mavenRoot = arg('maven'); // auto-detect a Maven project's modules → run multi
const includeTest = flag('include-test');

// --detect: report what auto-detection finds, then exit (confirm-first).
if (detectRoot) {
  // Stream live scan progress to stderr as the tree is walked, then the summary to stdout.
  process.stderr.write(`\n  Scanning ${detectRoot} …\n`);
  const gen = detectMavenStream(detectRoot);
  let ev = await gen.next();
  while (!ev.done) {
    const e = ev.value;
    if (e.type === 'project') process.stderr.write(`  · project [${e.index}/${e.total}] ${e.project}\n`);
    else if (e.type === 'module') process.stderr.write(`      module ${e.module}\n`);
    else if (e.type === 'candidate') process.stderr.write(`        ✓ [${e.candidate.confidence.toFixed(2)}] ${e.candidate.changelog} via ${e.candidate.detectedBy}${e.candidate.isTest ? ' (TEST)' : ''}${e.candidate.sqlUnsupported ? ' (SQL — unsupported)' : ''}\n`);
    else if (e.type === 'warning') process.stderr.write(`      ! ${e.message}\n`);
    ev = await gen.next();
  }
  const r = ev.value;
  process.stdout.write(`\n  Maven Liquibase detection — ${r.projectRoot}\n  projects: ${r.projects}   modules: ${r.modules}\n`);
  for (const c of r.candidates) process.stdout.write(`    [${c.confidence.toFixed(2)}] ${c.module} via ${c.detectedBy}${c.isTest ? ' (TEST)' : ''}${c.sqlUnsupported ? ' (SQL — unsupported)' : ''} → ${c.changelog}\n`);
  for (const w of r.warnings) process.stdout.write(`    ! ${w}\n`);
  process.stdout.write(`\n  Plan (one unit per module):\n${JSON.stringify(detectionToPlan(r, { includeTest }), null, 2)}\n\n`);
  process.exit(0);
}

if (!manifest && !mavenRoot && (!repo || !changelog)) {
  process.stderr.write('Usage: --repo <path> --changelog <file> [--src <dir>] [opts]\n   or: --manifest <repos.json>   (multi-repo)\n   or: --maven <projectRoot>     (auto-detect a Maven project, multi-module)\n   or: --detect <projectRoot>    (print detection only)\n');
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

const mavenRepos: RepoSpec[] | undefined = mavenRoot ? detectionToPlan(await detectMaven(mavenRoot), { includeTest }) : undefined;
if (mavenRoot) process.stderr.write(`  · detected ${mavenRepos!.length} module(s) in ${mavenRoot}\n`);

const { summary, drift, crossRepo, warnings } = manifest || mavenRoot
  ? await runReverseEngineerMulti({ repos: mavenRepos ?? (JSON.parse(fs.readFileSync(manifest!, 'utf-8')) as RepoSpec[]), ...shared })
  : await runReverseEngineer({ repoRoot: repo!, changelog: changelog!, srcDir: src, ...shared });

const lines = [
  '',
  `  Reverse-engineer — ${manifest || mavenRoot ? `multi-repo (${summary.repos?.join(', ')})` : repo}`,
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
if (warnings.length) {
  lines.push('', `  ⚠ Warnings (${warnings.length}):`);
  for (const w of warnings) lines.push(`    • ${w}`);
}
if (drift.length) {
  lines.push('', '  Drift findings:');
  for (const d of drift) lines.push(`    • [${d.kind}] ${d.element} — ${d.detail}`);
}
process.stdout.write(lines.join('\n') + '\n\n');
