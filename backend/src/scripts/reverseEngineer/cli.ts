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
import { runReverseEngineer } from '../../services/reverseEngineer/reverseEngineerService.js';
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

if (!repo || !changelog) {
  process.stderr.write('Usage: --repo <path> --changelog <master-changelog> [--src <java-dir>] [--out <dir>] [--no-jira]\n');
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

const { summary, drift } = await runReverseEngineer({
  repoRoot: repo,
  changelog,
  srcDir: src,
  jira: jiraConfig(),
  confluence: confluenceConfig(),
  out,
  emitDico,
  update,
  synthesis: synthesisMode === 'review' || synthesisMode === 'direct' ? { mode: synthesisMode } : undefined,
  onProgress: (e) => process.stderr.write(`  · ${e.stage}/${e.status}${e.detail ? ' — ' + e.detail : ''}\n`),
});
const lines = [
  '',
  `  Reverse-engineer — ${repo}`,
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
if (drift.length) {
  lines.push('', '  Drift findings:');
  for (const d of drift) lines.push(`    • [${d.kind}] ${d.element} — ${d.detail}`);
}
process.stdout.write(lines.join('\n') + '\n\n');
