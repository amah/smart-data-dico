/**
 * Migration: convert source/target → ends[] for all relationships (#100).
 *
 * Detects whether existing `source.name`/`target.name` use the correct
 * convention (source.name = source's field for reaching target) or the
 * inverted convention (source.name = target's field for reaching source)
 * by comparing the name string to the two entities' names + cardinality.
 *
 * Usage:
 *   tsx src/scripts/migrate-relationships-to-ends.ts [--apply] [--root <path>]
 *
 *   --apply       Write changes. Default is dry-run.
 *   --root PATH   data-dictionaries root. Defaults to ../data-dictionaries.
 */
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';

type Cardinality = 'one' | 'many';

interface End {
  entity: string;
  cardinality: Cardinality;
  name?: string;
  referenceAttributes?: string[];
}
interface EndNamed {
  entity: string;
  cardinality: Cardinality;
  role?: string;
  referenceAttributes?: string[];
}
interface Relationship {
  uuid: string;
  description?: string;
  type?: string;
  ends?: EndNamed[];
  source?: End;
  target?: End;
  metadata?: unknown[];
}

function camelize(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * Similarity score between a nav name and an entity name (0..1).
 * High score = the nav name looks like a field name derived from the entity.
 * Uses substring containment in both directions so shortened forms work
 * ("items" ~ "OrderItem" via containment: "orderitem".includes("item")).
 */
function nameSimilarity(name: string, entityName: string): number {
  const n = name.toLowerCase();
  const e = camelize(entityName).toLowerCase();
  if (n === e) return 1;
  if (n === e + 's' || n === e + 'es') return 0.95;  // simple plural
  if (e === n + 's' || e === n + 'es') return 0.9;   // singular form
  // Containment both ways — pick the max coverage
  if (e.includes(n)) return n.length / e.length;
  if (n.includes(e)) return e.length / n.length;
  // Strip trailing 's' and retry
  const nStripped = n.replace(/s$/, '');
  const eStripped = e.replace(/s$/, '');
  if (nStripped === eStripped) return 0.85;
  if (e.includes(nStripped)) return nStripped.length / e.length;
  if (n.includes(eStripped)) return eStripped.length / n.length;
  return 0;
}

interface EntityInfo { uuid: string; name: string }

function loadEntityNames(rootDir: string): Map<string, EntityInfo> {
  const map = new Map<string, EntityInfo>();
  const microservicesDir = path.join(rootDir, 'microservices');
  if (!fs.existsSync(microservicesDir)) return map;
  for (const pkg of fs.readdirSync(microservicesDir)) {
    const pkgDir = path.join(microservicesDir, pkg);
    if (!fs.statSync(pkgDir).isDirectory()) continue;
    for (const file of fs.readdirSync(pkgDir)) {
      if (!file.endsWith('.yaml') || file === 'relationships.yaml' || file === 'metadata.yaml' || file === 'rules.yaml' || file.endsWith('.rules.yaml') || file.endsWith('.comments.yaml')) continue;
      try {
        const content = fs.readFileSync(path.join(pkgDir, file), 'utf8');
        const entity = YAML.parse(content) as { uuid?: string; name?: string };
        if (entity?.uuid && entity?.name) {
          map.set(entity.uuid, { uuid: entity.uuid, name: entity.name });
        }
      } catch { /* skip unparseable */ }
    }
  }
  return map;
}

interface MigrationDecision {
  kind: 'correct' | 'inverted' | 'ambiguous' | 'already-migrated';
  ends: [EndNamed, EndNamed];
  reason: string;
}

function decide(rel: Relationship, entities: Map<string, EntityInfo>): MigrationDecision {
  if (rel.ends && rel.ends.length >= 2) {
    return {
      kind: 'already-migrated',
      ends: [rel.ends[0], rel.ends[1]],
      reason: 'already has ends[]',
    };
  }
  if (!rel.source || !rel.target) {
    // Shouldn't happen for valid data
    return {
      kind: 'ambiguous',
      ends: [
        rel.source ? { entity: rel.source.entity, cardinality: rel.source.cardinality } : { entity: '', cardinality: 'one' },
        rel.target ? { entity: rel.target.entity, cardinality: rel.target.cardinality } : { entity: '', cardinality: 'one' },
      ],
      reason: 'missing source or target',
    };
  }
  const srcEntity = entities.get(rel.source.entity);
  const tgtEntity = entities.get(rel.target.entity);
  const srcName = rel.source.name;
  const tgtName = rel.target.name;

  // Score each hypothesis: does source.name describe target (correct) or source (inverted)?
  const srcToTargetScore = srcName && tgtEntity ? nameSimilarity(srcName, tgtEntity.name) : 0;
  const srcToSourceScore = srcName && srcEntity ? nameSimilarity(srcName, srcEntity.name) : 0;
  const tgtToSourceScore = tgtName && srcEntity ? nameSimilarity(tgtName, srcEntity.name) : 0;
  const tgtToTargetScore = tgtName && tgtEntity ? nameSimilarity(tgtName, tgtEntity.name) : 0;

  // Correct convention: source.name → target, target.name → source
  const correctScore = srcToTargetScore + tgtToSourceScore;
  // Inverted convention: source.name → source, target.name → target
  const invertedScore = srcToSourceScore + tgtToTargetScore;

  const threshold = 0.5;
  const isInverted = invertedScore > correctScore && invertedScore >= threshold;
  const isCorrect = correctScore > invertedScore && correctScore >= threshold;

  if (isInverted) {
    // Swap: what was under source.name belongs at target's end, and vice versa
    return {
      kind: 'inverted',
      ends: [
        { entity: rel.source.entity, cardinality: rel.source.cardinality, role: tgtName, ...(rel.source.referenceAttributes && { referenceAttributes: rel.source.referenceAttributes }) },
        { entity: rel.target.entity, cardinality: rel.target.cardinality, role: srcName, ...(rel.target.referenceAttributes && { referenceAttributes: rel.target.referenceAttributes }) },
      ],
      reason: `srcName "${srcName}" matches source entity "${srcEntity?.name}" (${srcToSourceScore.toFixed(2)}); tgtName "${tgtName}" matches target entity "${tgtEntity?.name}" (${tgtToTargetScore.toFixed(2)})`,
    };
  }

  return {
    kind: isCorrect ? 'correct' : 'ambiguous',
    ends: [
      { entity: rel.source.entity, cardinality: rel.source.cardinality, role: srcName, ...(rel.source.referenceAttributes && { referenceAttributes: rel.source.referenceAttributes }) },
      { entity: rel.target.entity, cardinality: rel.target.cardinality, role: tgtName, ...(rel.target.referenceAttributes && { referenceAttributes: rel.target.referenceAttributes }) },
    ],
    reason: isCorrect
      ? `srcName "${srcName}" describes target "${tgtEntity?.name}" (${srcToTargetScore.toFixed(2)}); tgtName "${tgtName}" describes source "${srcEntity?.name}" (${tgtToSourceScore.toFixed(2)})`
      : `ambiguous (correct=${correctScore.toFixed(2)}, inverted=${invertedScore.toFixed(2)}, srcName="${srcName}", tgtName="${tgtName}") — preserving as-is`,
  };
}

function migrateFile(filePath: string, entities: Map<string, EntityInfo>, apply: boolean): { changed: number; decisions: Array<{ uuid: string; kind: string; reason: string }> } {
  const content = fs.readFileSync(filePath, 'utf8');
  const rels = (YAML.parse(content) as Relationship[]) || [];
  const decisions: Array<{ uuid: string; kind: string; reason: string }> = [];
  let changed = 0;
  const migrated: Relationship[] = rels.map(rel => {
    const d = decide(rel, entities);
    decisions.push({ uuid: rel.uuid, kind: d.kind, reason: d.reason });
    if (d.kind === 'already-migrated') return rel;
    changed++;
    // Emit new shape: ends[] first, drop source/target. Keep other fields.
    const { source: _s, target: _t, ends: _e, ...rest } = rel;
    void _s; void _t; void _e;
    return { ...rest, ends: d.ends };
  });
  if (changed > 0 && apply) {
    fs.writeFileSync(filePath, YAML.stringify(migrated), 'utf8');
  }
  return { changed, decisions };
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const rootIdx = args.indexOf('--root');
  const rootDir = rootIdx >= 0
    ? path.resolve(args[rootIdx + 1])
    : path.resolve(process.cwd(), '..', 'data-dictionaries');

  if (!fs.existsSync(rootDir)) {
    console.error(`Data directory not found: ${rootDir}`);
    process.exit(1);
  }

  console.log(`Migrating relationships in ${rootDir} (${apply ? 'APPLY' : 'DRY RUN'})`);
  const entities = loadEntityNames(rootDir);
  console.log(`Loaded ${entities.size} entities for name lookup\n`);

  const microservicesDir = path.join(rootDir, 'microservices');
  const pkgs = fs.readdirSync(microservicesDir).filter(p =>
    fs.statSync(path.join(microservicesDir, p)).isDirectory(),
  );

  let totalChanged = 0;
  for (const pkg of pkgs) {
    const relFile = path.join(microservicesDir, pkg, 'relationships.yaml');
    if (!fs.existsSync(relFile)) continue;
    const { changed, decisions } = migrateFile(relFile, entities, apply);
    if (changed === 0) continue;
    totalChanged += changed;
    console.log(`[${pkg}] ${changed} relationship${changed === 1 ? '' : 's'} to migrate:`);
    for (const d of decisions) {
      const marker = d.kind === 'inverted' ? '↻' : d.kind === 'correct' ? '✓' : d.kind === 'ambiguous' ? '?' : '·';
      console.log(`  ${marker} ${d.uuid.padEnd(40)} [${d.kind}]`);
      console.log(`     ${d.reason}`);
    }
    console.log('');
  }

  console.log(`\nTotal: ${totalChanged} relationship${totalChanged === 1 ? '' : 's'} ${apply ? 'migrated' : 'would be migrated'}`);
  if (!apply && totalChanged > 0) {
    console.log('\nDry run — re-run with --apply to write changes.');
  }
}

main();
