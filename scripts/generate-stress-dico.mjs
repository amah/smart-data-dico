// Generate a large synthetic Smart Data Dictionary project for performance
// testing (reproduces home-page load with many entities/relationships).
//
// Usage:
//   node scripts/generate-stress-dico.mjs [outDir]
//   ENTITIES=2000 RELATIONSHIPS=800 PACKAGES=20 node scripts/generate-stress-dico.mjs ./stress-dico
//
// Then point the app at it:
//   smart-data-dico --data-dir <outDir>
//
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stringify } from 'yaml';

const OUT          = resolve(process.argv[2] || './stress-dico');
const ENTITIES     = Number(process.env.ENTITIES      || 2000);
const RELATIONSHIPS= Number(process.env.RELATIONSHIPS || 800);
const PACKAGES     = Number(process.env.PACKAGES      || 20);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;

// Attribute count per entity: exponential(mean 3) shifted by +2, clamped to
// [2,15] → a right-skewed distribution with mean ≈ 5 (most entities small,
// a few large), matching the reported "2..15, mean 5" shape.
function fieldCount() {
  const n = 2 + Math.floor(-Math.log(1 - Math.random()) * 3.5);
  return Math.min(15, Math.max(2, n));
}

// Weighted attribute types — string-heavy, like real models.
const TYPE_WEIGHTS = [['string',6],['integer',3],['number',2],['boolean',2],['datetime',2],['date',1],['enum',1],['uuid',1]];
const TYPE_POOL = TYPE_WEIGHTS.flatMap(([t, w]) => Array(w).fill(t));
const NAME_FRAGS = ['code','name','status','amount','date','count','flag','ref','type','label','value','total','note','url','email','phone','rank','score','qty','price','owner','region','tier','stage'];
const ENUM_VALUES = ['PENDING','ACTIVE','CLOSED','ARCHIVED','DRAFT'];

function makeAttribute(j) {
  const type = j === 0 ? 'uuid' : pick(TYPE_POOL);     // first attr is the PK
  const attr = {
    uuid: randomUUID(),
    name: j === 0 ? 'id' : `${pick(NAME_FRAGS)}_${j}`,
    description: `Synthetic ${type} attribute #${j}`,
    type,
    required: j === 0 ? true : chance(0.5),
  };
  if (j === 0) attr.primaryKey = true;
  if (type === 'enum') attr.validation = { enumValues: [...ENUM_VALUES] };
  else if (type === 'string' && chance(0.4)) attr.validation = { maxLength: pick([50, 100, 255]) };
  else if (type === 'number' && chance(0.3)) attr.validation = { minimum: 0, precision: 12, scale: 2 };
  return attr;
}

function makeEntity(pkgIdx, idx) {
  const name = `P${String(pkgIdx).padStart(2,'0')}_Entity_${String(idx).padStart(4,'0')}`; // globally unique
  const n = fieldCount();
  return {
    uuid: randomUUID(),
    name,
    description: `Synthetic entity ${name}`,
    status: 'approved',
    attributes: Array.from({ length: n }, (_, j) => makeAttribute(j)),
  };
}

// ── build ──────────────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'dico.config.json'), JSON.stringify({ version: 1, types: [] }, null, 2) + '\n');

const perPkg = Math.ceil(ENTITIES / PACKAGES);
const allEntities = [];   // { uuid, pkg }
let attrTotal = 0, made = 0;

for (let p = 0; p < PACKAGES && made < ENTITIES; p++) {
  const pkgName = `pkg-${String(p).padStart(2,'0')}`;
  const pkgDir = join(OUT, pkgName);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.yaml'), stringify({ name: pkgName }));

  for (let i = 0; i < perPkg && made < ENTITIES; i++, made++) {
    const e = makeEntity(p, i);
    attrTotal += e.attributes.length;
    allEntities.push({ uuid: e.uuid, pkg: pkgName });
    writeFileSync(join(pkgDir, `${e.name}.model.yaml`), stringify({ entities: [e] }));
  }
}

// Relationships: random distinct entity pairs, filed in the source entity's
// package. UUID-based refs may cross packages — that's valid.
const relsByPkg = new Map();
for (let r = 0; r < RELATIONSHIPS; r++) {
  const a = pick(allEntities);
  let b = pick(allEntities);
  while (b.uuid === a.uuid) b = pick(allEntities);
  const cardB = chance(0.6) ? 'many' : 'one';
  const rel = {
    uuid: randomUUID(),
    description: `Synthetic relationship ${r}`,
    type: 'structural',
    // Preferred symmetric shape (#99) …
    ends: [
      { entity: a.uuid, cardinality: 'one',  role: `rel${r}_a` },
      { entity: b.uuid, cardinality: cardB, role: `rel${r}_b` },
    ],
    // … plus source/target, which the schema still requires.
    source: { entity: a.uuid, cardinality: 'one',  name: `rel${r}_a` },
    target: { entity: b.uuid, cardinality: cardB, name: `rel${r}_b` },
  };
  if (!relsByPkg.has(a.pkg)) relsByPkg.set(a.pkg, []);
  relsByPkg.get(a.pkg).push(rel);
}
for (const [pkg, rels] of relsByPkg) {
  writeFileSync(join(OUT, pkg, 'relationships.model.yaml'), stringify({ relationships: rels }));
}

// ── summary ─────────────────────────────────────────────────────────────────
console.log(`Generated stress dico at: ${OUT}`);
console.log(`  packages:      ${relsByPkg.size <= PACKAGES ? PACKAGES : PACKAGES} (${PACKAGES})`);
console.log(`  entities:      ${made}`);
console.log(`  attributes:    ${attrTotal}  (mean ${(attrTotal / made).toFixed(2)} per entity, range 2–15)`);
console.log(`  relationships: ${RELATIONSHIPS}`);
console.log(`\nRun:  smart-data-dico --data-dir ${OUT}`);
