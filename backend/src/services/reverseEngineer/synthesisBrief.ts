/**
 * Synthesis package generator (deterministic — NO LLM here).
 *
 * Produces a self-contained, provider-agnostic package that ANY agent (external
 * — opencode / claude-code / cursor — or the Smart Data Dico integrated agent)
 * uses to write entity/attribute descriptions and propose business rules,
 * grounded in the reverse-engineered evidence:
 *
 *   synthesis/
 *     AGENT.md                 ← handoff: goal, grounding, output mode, rules
 *     briefs/<Entity>.md       ← grounded INPUT per entity (facts/drift/jira/confluence)
 *     proposals/<Entity>.md    ← review-mode OUTPUT template (human-reviewable)
 *
 * The LLM call is intentionally NOT made here — the package is the contract.
 */
import fs from 'fs';
import path from 'path';
import type { CIRElement } from './types.js';
import type { DriftFinding } from './drift.js';
import type { JiraIssue } from './jira.js';

export type SynthesisMode = 'review' | 'direct';

export interface SynthesisOptions {
  outDir: string; // where to write the synthesis/ folder (usually the emitted dico project)
  mode: SynthesisMode;
  jiraIssues?: Map<string, JiraIssue>;
  confluenceDir?: string; // enrichment/confluence dir to mine excerpts from
  dicoPackage?: string; // package folder name in the dico project (for direct-mode paths)
  repoRoot?: string;
}

export interface SynthesisResult {
  synthesisDir: string;
  briefs: number;
}

const simple = (fqcn?: string) => fqcn?.split('.').pop();
const pascal = (s: string) => s.replace(/(^|[_\-\s])(\w)/g, (_, __, c) => c.toUpperCase());

interface ConfPage { title: string; text: string }
function readConfluence(dir?: string): ConfPage[] {
  if (!dir || !fs.existsSync(dir)) return [];
  const out: ConfPage[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf-8');
    const title = raw.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] ?? f;
    const text = raw.replace(/^---[\s\S]*?---\n/, '').trim();
    out.push({ title, text });
  }
  return out;
}

export function emitSynthesisPackage(elements: CIRElement[], drift: DriftFinding[], opts: SynthesisOptions): SynthesisResult {
  const root = path.join(path.resolve(opts.outDir), 'synthesis');
  const briefsDir = path.join(root, 'briefs');
  fs.mkdirSync(briefsDir, { recursive: true });
  if (opts.mode === 'review') fs.mkdirSync(path.join(root, 'proposals'), { recursive: true });

  const issues = opts.jiraIssues ?? new Map<string, JiraIssue>();
  const confluence = readConfluence(opts.confluenceDir);
  const driftByEl = new Map<string, DriftFinding[]>();
  for (const d of drift) (driftByEl.get(d.element) ?? driftByEl.set(d.element, []).get(d.element)!).push(d);

  const entities = elements.filter((e) => e.kind === 'entity');
  for (const ent of entities) {
    const table = ent.names.physical?.table ?? ent.id.replace(/^entity:/, '');
    const name = simple(ent.names.logical?.fqcn) ?? pascal(table);
    const attrs = elements.filter((a) => a.kind === 'attribute' && a.names.physical?.table === table);
    const rels = elements.filter((r) => r.kind === 'relationship' && (r.facts.source === `entity:${table}`));

    const tickets = [...new Set(elements
      .filter((e) => e.names.physical?.table === table || e.id === ent.id)
      .flatMap((e) => e.provenance.map((p) => p.ticket).filter(Boolean) as string[]))];

    const matched = confluence.filter((p) =>
      p.title.toLowerCase().includes(name.toLowerCase()) ||
      p.text.toLowerCase().includes(table.toLowerCase()) ||
      p.text.toLowerCase().includes(name.toLowerCase()),
    );

    writeBrief(path.join(briefsDir, `${name}.md`), { name, table, fqcn: ent.names.logical?.fqcn, attrs, rels, tickets, issues, matched, driftByEl });
    if (opts.mode === 'review') writeProposalTemplate(path.join(root, 'proposals', `${name}.md`), name, attrs);
  }

  writeAgentDoc(path.join(root, 'AGENT.md'), opts, entities.length);
  return { synthesisDir: root, briefs: entities.length };
}

function attrName(a: CIRElement): string {
  return a.names.logical?.field ?? a.names.physical?.column ?? a.id.split('.').pop()!;
}

function writeBrief(file: string, ctx: {
  name: string; table: string; fqcn?: string; attrs: CIRElement[]; rels: CIRElement[];
  tickets: string[]; issues: Map<string, JiraIssue>; matched: ConfPage[]; driftByEl: Map<string, DriftFinding[]>;
}): void {
  const L: string[] = [];
  L.push(`# ${ctx.name}`, '', `- table: \`${ctx.table}\`${ctx.fqcn ? ` · class: \`${ctx.fqcn}\`` : ''}`, '');

  L.push('## Attributes', '', '| field | column | type | required | validation | drift |', '|---|---|---|---|---|---|');
  for (const a of ctx.attrs) {
    const v = a.facts.validation as Record<string, unknown> | undefined;
    const dr = (ctx.driftByEl.get(a.id) ?? []).map((d) => d.kind).join(', ');
    L.push(`| ${attrName(a)} | ${a.names.physical?.column ?? ''} | ${a.facts.dataType ?? ''} | ${a.facts.nullable === false ? 'yes' : 'no'} | ${v ? JSON.stringify(v) : ''} | ${dr} |`);
  }
  L.push('');

  if (ctx.rels.length) {
    L.push('## Relationships', '');
    for (const r of ctx.rels) L.push(`- ${ctx.name} —(${r.facts.cardinality})→ ${String(r.facts.target).replace(/^entity:/, '')} (FK: ${(r.facts.foreignKeyColumns as string[] ?? []).join(', ')})`);
    L.push('');
  }

  const allDrift = ctx.attrs.flatMap((a) => ctx.driftByEl.get(a.id) ?? []);
  if (allDrift.length) {
    L.push('## ⚠ Drift (JPA ⇄ DB)', '');
    for (const d of allDrift) L.push(`- **${d.kind}** \`${d.element.replace(/^attribute:/, '')}\` — ${d.detail}`);
    L.push('');
  }

  if (ctx.tickets.length) {
    L.push('## Jira context', '');
    for (const t of ctx.tickets) {
      const i = ctx.issues.get(t);
      if (i) {
        L.push(`### ${t} — ${i.summary}  _(${i.type ?? '?'}, ${i.status ?? '?'})_`);
        if (i.description) L.push('', i.description.trim());
        L.push('');
      } else {
        L.push(`### ${t} _(not fetched — configure Jira to enrich)_`, '');
      }
    }
  }

  if (ctx.matched.length) {
    L.push('## Confluence excerpts', '');
    for (const p of ctx.matched.slice(0, 3)) {
      L.push(`### ${p.title}`, '', p.text.slice(0, 600).trim() + (p.text.length > 600 ? ' …' : ''), '');
    }
  }

  L.push(
    '## TODO (for the AI agent)',
    '',
    'Grounded **only** in the evidence above, produce:',
    '- a 1–3 sentence **entity description**;',
    '- a one-line **description for each attribute** that lacks one;',
    '- candidate **business rules** — cross-field / lifecycle invariants implied by the Jira/Confluence context (mark each `[proposed]`).',
    '',
    'Rules: **cite the source** (Jira key / Confluence title / commit) for every claim. If nothing supports a statement, leave it blank and add a `NEEDS-INFO` note. Do **not** invent business logic. Call out drift; do not silently "fix" it.',
    '',
  );
  fs.writeFileSync(file, L.join('\n') + '\n');
}

function writeProposalTemplate(file: string, name: string, attrs: CIRElement[]): void {
  const L = [`# ${name} — proposal`, '', `> Fill from \`briefs/${name}.md\`. Cite sources. Leave blank if unsupported.`, '', '## description', '', '<!-- entity description here -->', '', '## attributes'];
  for (const a of attrs) L.push(`- ${attrName(a)}: `);
  L.push('', '## rules (proposed)', '- ', '', '## notes / NEEDS-INFO', '- ', '');
  fs.writeFileSync(file, L.join('\n') + '\n');
}

function writeAgentDoc(file: string, opts: SynthesisOptions, entityCount: number): void {
  const pkg = opts.dicoPackage ?? 'reverse-engineered';
  const L = [
    '# Synthesis handoff — complete the reverse-engineered data dictionary',
    '',
    `This data dictionary was reverse-engineered${opts.repoRoot ? ` from \`${opts.repoRoot}\`` : ''}. The **structural** model (entities, attributes, relationships, constraints) is already correct and lives in the smart-data-dico project alongside this folder. Your job is the **prose + rules**: write descriptions and propose business rules, grounded in the evidence.`,
    '',
    `Grounding briefs: \`./briefs/<Entity>.md\` (${entityCount} entities). Each bundles the facts, drift, linked Jira issues and Confluence excerpts for one entity.`,
    '',
    '## Output mode: **' + opts.mode + '**',
    opts.mode === 'review'
      ? `- Write your proposals into \`./proposals/<Entity>.md\` (one per entity). **Do not edit the dico YAML.** A human reviews them, then runs the apply step to merge approved text into the dictionary.`
      : `- Edit the dico project YAML directly: \`../${pkg}/<Entity>.model.yaml\` — set entity \`description\`, per-attribute \`description\`, and add \`rules\`.`,
    '',
    '## Rules',
    '- **Cite the source** (Jira key / Confluence title / commit) for every statement.',
    '- **Do not invent** business logic. If unsupported, leave it blank and add a `NEEDS-INFO` note.',
    '- **Drift findings are flagged** in the briefs — surface them; never silently reconcile JPA vs DB.',
    '',
    '## Who runs this',
    '- **External agent** (opencode, claude code, cursor): open this folder, read `briefs/`, write per the mode above.',
    '- **Smart Data Dico integrated agent**: use the reverse-engineer tools — `listSynthesisBriefs`, `getSynthesisBrief` to ground, then `updateEntity` / `createRule` (direct) or write proposals (review).',
    '',
  ];
  fs.writeFileSync(file, L.join('\n') + '\n');
}
