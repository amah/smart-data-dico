/**
 * Read access to the synthesis package for the integrated AI agent.
 *
 * The agent grounds its prose pass by reading the per-entity briefs produced by
 * emitSynthesisPackage() into the active project's `synthesis/briefs/`. Pairs
 * with the agent's existing write tools (updateEntity / createRule). Lives here
 * (not in controllers/) because reading the briefs needs raw fs, which is
 * allow-listed for this directory.
 */
import fs from 'fs';
import path from 'path';

const briefsDir = (dataDir: string) => path.join(dataDir, 'synthesis', 'briefs');

/** List entities that have a reverse-engineering synthesis brief in the active project. */
export function listSynthesisBriefs(dataDir: string): { summary: string; briefs: string[] } {
  const dir = briefsDir(dataDir);
  let briefs: string[] = [];
  try {
    briefs = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();
  } catch { /* no synthesis package in this project */ }
  return {
    summary: briefs.length
      ? `${briefs.length} synthesis briefs: ${briefs.join(', ')}`
      : 'No synthesis briefs found (run reverse-engineer with synthesis enabled, then open that project).',
    briefs,
  };
}

/** Return the grounded brief markdown for one entity. */
export function getSynthesisBrief(dataDir: string, entityName: string): { entity: string; content: string } | { error: string } {
  const file = path.join(briefsDir(dataDir), `${entityName}.md`);
  try {
    return { entity: entityName, content: fs.readFileSync(file, 'utf-8') };
  } catch {
    return { error: `No synthesis brief for "${entityName}". Call listSynthesisBriefs first.` };
  }
}
