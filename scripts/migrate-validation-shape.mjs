#!/usr/bin/env node
/**
 * One-shot migration for #85 R4: rewrite the sample data dictionary YAML
 * files into the new canonical shape:
 *
 *   - Flat validation fields on the attribute root → nested under
 *     `validation:` (matches the AttributeValidation interface)
 *   - Legacy `constraints:` nested block → renamed to `validation:`
 *   - Legacy object-shape `metadata: {key: value}` → MetadataEntry[]
 *
 * Reads + writes YAML in place. Idempotent — running it twice is a no-op
 * because the rewritten files are already in canonical shape and the
 * normalizer rules below are skip-when-not-applicable.
 *
 * Out of scope (deferred):
 *   - The legacy top-level `id`, `microservice`, `version` fields
 *   - The legacy nested `relationships:` block (the canonical model uses
 *     a separate package-level `relationships.yaml`)
 *
 * These pre-#85 concerns will be cleaned up by their own migration when
 * we tackle them; #85 R4 only fixes the validation/constraint vocabulary.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import YAML from 'yaml';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const MICROSERVICES = path.join(ROOT, 'data-dictionaries', 'microservices');

const VALIDATION_FIELDS = [
  'minLength', 'maxLength', 'pattern', 'format',
  'minimum', 'maximum', 'precision', 'scale',
  'enumValues',
];

let filesChanged = 0;
let attrsRewritten = 0;
let constraintsRenamed = 0;
let metadataNormalized = 0;

function normalizeAttribute(attr) {
  let touched = false;

  // 1. Legacy nested-as-`constraints` → `validation`
  if (attr.constraints && typeof attr.constraints === 'object') {
    attr.validation = { ...(attr.validation || {}), ...attr.constraints };
    delete attr.constraints;
    constraintsRenamed++;
    touched = true;
  }

  // 2. Flat validation fields on attribute root → nested `validation`
  for (const f of VALIDATION_FIELDS) {
    if (attr[f] !== undefined) {
      attr.validation = attr.validation || {};
      attr.validation[f] = attr[f];
      delete attr[f];
      touched = true;
    }
  }

  // 3. Object-shape metadata → MetadataEntry[]
  if (attr.metadata && !Array.isArray(attr.metadata) && typeof attr.metadata === 'object') {
    attr.metadata = Object.entries(attr.metadata).map(([name, value]) => ({ name, value }));
    metadataNormalized++;
    touched = true;
  }

  if (touched) attrsRewritten++;
  return touched;
}

function isEntityFile(filename) {
  if (!filename.endsWith('.yaml')) return false;
  if (filename.endsWith('.comments.yaml')) return false;
  if (filename.endsWith('.rules.yaml')) return false;
  if (filename === 'relationships.yaml') return false;
  if (filename === 'rules.yaml') return false;
  return true;
}

function processFile(filepath) {
  const text = fs.readFileSync(filepath, 'utf8');
  const doc = YAML.parse(text);
  if (!doc || typeof doc !== 'object') return;
  if (!Array.isArray(doc.attributes)) return;

  let changed = false;
  for (const attr of doc.attributes) {
    if (normalizeAttribute(attr)) changed = true;
  }

  // Entity-level metadata (rare, but handle just in case)
  if (doc.metadata && !Array.isArray(doc.metadata) && typeof doc.metadata === 'object') {
    doc.metadata = Object.entries(doc.metadata).map(([name, value]) => ({ name, value }));
    metadataNormalized++;
    changed = true;
  }

  if (changed) {
    // Round-trip through the YAML library to keep formatting consistent.
    // Use lineWidth: 0 to avoid wrapping long strings (e.g. patterns).
    const output = YAML.stringify(doc, { lineWidth: 0 });
    fs.writeFileSync(filepath, output, 'utf8');
    filesChanged++;
    console.log(`✓ ${path.relative(ROOT, filepath)}`);
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (isEntityFile(entry.name)) {
      processFile(full);
    }
  }
}

walk(MICROSERVICES);

console.log('');
console.log(`Files rewritten:        ${filesChanged}`);
console.log(`Attributes touched:     ${attrsRewritten}`);
console.log(`'constraints:' renamed: ${constraintsRenamed}`);
console.log(`Metadata normalized:    ${metadataNormalized}`);
