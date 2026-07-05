/**
 * dicoConfigService (#107) — read/write `dico.config.json`.
 *
 * Owns the project-level config document that sits at the data-dictionaries
 * root. Added in #107: a `types[]` array of **derived data types** that
 * share an AttributeType base and carry reusable `validation` metadata.
 *
 * Resolution is transitive (`work-email` → `email` → `string`), with
 * per-level `validation` fields merged from base toward derived. Circular
 * derivation is detected at load time and surfaced as an error to the
 * caller so project open can fail loudly.
 */
import { AttributeType, AttributeValidation } from '../models/EntitySchema.js';
import { logger } from '../utils/logger.js';
import { storageRegistry } from '../storage/contract/StorageBackendToken.js';
import { wsId, pathOf } from '../storage/contract/types.js';

/**
 * The kind of value domain a derived type carries (#TBD). Distinguishes how an
 * attribute's allowed values are constrained:
 *  - `enum`      — a closed, inline set of literal values. Self-contained, no source.
 *  - `codelist`  — a *static* managed reference set identified by `source` (e.g.
 *                  "ISO-4217"); the codes themselves may also be carried in `values`.
 *  - `reference` — *referential* values drawn from a named external/internal data
 *                  `source` (another type, an entity, a dataset). Values are not inline.
 */
export type ValueDomainKind = 'enum' | 'codelist' | 'reference';

export interface ValueDomain {
  kind: ValueDomainKind;
  /** enum & codelist: the allowed/static values. */
  values?: string[];
  /** codelist & reference: the source name that identifies where values come from. */
  source?: string;
}

/** One derived type entry persisted under `dico.config.json.types[]`. */
export interface DerivedType {
  /** Identifier used as `attribute.type` on attributes (e.g. "email"). */
  name: string;
  /**
   * Either a standard `AttributeType` (string/number/...) or the `name` of
   * another derived type. Transitive derivation resolves through the chain.
   */
  basedOn: string;
  /** Optional human-readable description. */
  description?: string;
  /** Validation fields inherited by every attribute declaring this type. */
  validation?: AttributeValidation;
  /**
   * Optional value domain (#TBD) — distinguishes enum / codelist / reference.
   * Orthogonal to `validation`; only the most-derived type's domain applies.
   */
  domain?: ValueDomain;
}

const DOMAIN_KINDS = new Set<ValueDomainKind>(['enum', 'codelist', 'reference']);

/**
 * A declarative rule that hides model elements whose name matches `pattern`.
 * Used to bulk-suppress reverse-engineering waste (backup/temp/staging tables)
 * without touching every element. `pattern` is a glob by default, or a regex
 * when `regex` is true. See `visibilityService`.
 */
export interface HideRule {
  match: 'physicalTableName' | 'entityName' | 'packageName';
  pattern: string;
  regex?: boolean;
  reason?: string;
}

/**
 * A named visual style (#element-style) applied to model elements by their role.
 * Colors are theme-token names (e.g. `primary`, `neutral`, `warning`, `*-subtle`)
 * or hex; the frontend maps them to the diagram theme. See `docs/element-style.md`.
 */
export interface ElementStyle {
  name: string;                 // stable kebab id
  label?: string;
  fill?: string;
  border?: string;
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  shape?: string;
  opacity?: number;
  textColor?: string;
  badge?: string;               // short tag, e.g. "AR"
  emphasis?: boolean | number;  // level 1 light / 2 medium / 3 strong (true = 3); z-order boost
  default?: boolean;            // applied to any element nothing else styles (at most one)
}

/** Binds an {@link ElementStyle} to elements matching a role/name (glob or regex). */
export interface StyleRule {
  match: 'stereotype' | 'role' | 'entityName' | 'physicalTableName';
  pattern: string;
  regex?: boolean;
  style: string;                // → ElementStyle.name
}

export interface DicoConfig {
  version: number;
  types?: DerivedType[];
  hideRules?: HideRule[];
  elementStyles?: ElementStyle[];
  styleRules?: StyleRule[];
}

const HIDE_MATCH_KINDS = new Set(['physicalTableName', 'entityName', 'packageName']);
const STYLE_MATCH_KINDS = new Set(['stereotype', 'role', 'entityName', 'physicalTableName']);
const STYLE_BORDER_STYLES = new Set(['solid', 'dashed', 'dotted']);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Workspace + path for `dico.config.json` (at the dictionaries-workspace root). */
const DICT_WS = wsId('dictionaries');
const CONFIG_PATH = pathOf('dico.config.json');

/** Standard AttributeType enum values, used to detect leaf bases. */
const STANDARD_TYPES = new Set<string>(Object.values(AttributeType));

/** Read the full config document. Returns a zero-value if missing. */
export async function readConfig(): Promise<DicoConfig> {
  try {
    const raw = await storageRegistry.getBackend().read(DICT_WS, CONFIG_PATH);
    const parsed = JSON.parse(raw);
    if (typeof parsed.version !== 'number') parsed.version = 1;
    return parsed as DicoConfig;
  } catch (e) {
    if ((e as { code?: string }).code === 'not-found') return { version: 1 };
    logger.error(`Failed to read dico.config.json: ${e}`);
    return { version: 1 };
  }
}

async function writeConfig(next: DicoConfig): Promise<void> {
  const body = JSON.stringify(next, null, 2) + '\n';
  await storageRegistry.getBackend().write(DICT_WS, CONFIG_PATH, body);
}

/** Return the current `types[]` list, or `[]` if unset. */
export async function listDerivedTypes(): Promise<DerivedType[]> {
  const cfg = await readConfig();
  return Array.isArray(cfg.types) ? cfg.types : [];
}

/** Return the current `hideRules[]` list, or `[]` if unset. */
export async function listHideRules(): Promise<HideRule[]> {
  const cfg = await readConfig();
  return Array.isArray(cfg.hideRules) ? cfg.hideRules : [];
}

/** Structural validation of a hide-rules array: known `match`, non-empty
 *  `pattern`, and a compilable regex when `regex` is set. */
export function validateHideRules(rules: HideRule[]): string[] {
  const errors: string[] = [];
  rules.forEach((r, i) => {
    if (!r || typeof r !== 'object') { errors.push(`Rule ${i}: must be an object`); return; }
    if (!HIDE_MATCH_KINDS.has(r.match)) errors.push(`Rule ${i}: match must be one of ${[...HIDE_MATCH_KINDS].join(', ')}`);
    if (!r.pattern || typeof r.pattern !== 'string') errors.push(`Rule ${i}: pattern is required`);
    if (r.regex && typeof r.pattern === 'string') {
      try { new RegExp(r.pattern); } catch { errors.push(`Rule ${i}: invalid regex "${r.pattern}"`); }
    }
  });
  return errors;
}

/** Replace the full `hideRules[]` list (validates first). */
export async function replaceHideRules(next: HideRule[]): Promise<{ success: boolean; errors?: string[] }> {
  if (!Array.isArray(next)) return { success: false, errors: ['Body must be an array of hide rules'] };
  const errors = validateHideRules(next);
  if (errors.length > 0) return { success: false, errors };
  const cfg = await readConfig();
  cfg.hideRules = next;
  await writeConfig(cfg);
  return { success: true };
}

// ── Element styles + style rules (#element-style) ────────────────────────────

export async function listElementStyles(): Promise<ElementStyle[]> {
  const cfg = await readConfig();
  return Array.isArray(cfg.elementStyles) ? cfg.elementStyles : [];
}

export async function listStyleRules(): Promise<StyleRule[]> {
  const cfg = await readConfig();
  return Array.isArray(cfg.styleRules) ? cfg.styleRules : [];
}

/** Validate named styles: kebab unique `name`, sane `borderStyle`/`opacity`. */
export function validateElementStyles(styles: ElementStyle[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  styles.forEach((s, i) => {
    if (!s || typeof s !== 'object') { errors.push(`Style ${i}: must be an object`); return; }
    if (!s.name || !KEBAB.test(s.name)) errors.push(`Style ${i}: name must be kebab-case`);
    else if (seen.has(s.name)) errors.push(`Style ${i}: duplicate name "${s.name}"`);
    else seen.add(s.name);
    if (s.borderStyle && !STYLE_BORDER_STYLES.has(s.borderStyle)) errors.push(`Style ${i}: borderStyle must be one of ${[...STYLE_BORDER_STYLES].join(', ')}`);
    if (s.opacity != null && (typeof s.opacity !== 'number' || s.opacity < 0 || s.opacity > 1)) errors.push(`Style ${i}: opacity must be 0..1`);
    if (s.borderWidth != null && (typeof s.borderWidth !== 'number' || s.borderWidth < 0)) errors.push(`Style ${i}: borderWidth must be ≥ 0`);
    if (s.emphasis != null && typeof s.emphasis !== 'boolean' && !(typeof s.emphasis === 'number' && Number.isInteger(s.emphasis) && s.emphasis >= 1 && s.emphasis <= 3))
      errors.push(`Style ${i}: emphasis must be a boolean or a level 1–3`);
  });
  if (styles.filter((s) => s?.default).length > 1) errors.push('At most one style may be marked default');
  return errors;
}

/** Validate style rules: known `match`, non-empty `pattern`, compilable regex,
 *  and a `style` that names one of `knownStyles` (when provided). */
export function validateStyleRules(rules: StyleRule[], knownStyles?: string[]): string[] {
  const errors: string[] = [];
  const known = knownStyles ? new Set(knownStyles) : null;
  rules.forEach((r, i) => {
    if (!r || typeof r !== 'object') { errors.push(`Rule ${i}: must be an object`); return; }
    if (!STYLE_MATCH_KINDS.has(r.match)) errors.push(`Rule ${i}: match must be one of ${[...STYLE_MATCH_KINDS].join(', ')}`);
    if (!r.pattern || typeof r.pattern !== 'string') errors.push(`Rule ${i}: pattern is required`);
    if (!r.style || typeof r.style !== 'string') errors.push(`Rule ${i}: style is required`);
    else if (known && !known.has(r.style)) errors.push(`Rule ${i}: style "${r.style}" is not a defined element style`);
    if (r.regex && typeof r.pattern === 'string') {
      try { new RegExp(r.pattern); } catch { errors.push(`Rule ${i}: invalid regex "${r.pattern}"`); }
    }
  });
  return errors;
}

export async function replaceElementStyles(next: ElementStyle[]): Promise<{ success: boolean; errors?: string[] }> {
  if (!Array.isArray(next)) return { success: false, errors: ['Body must be an array of element styles'] };
  const errors = validateElementStyles(next);
  if (errors.length > 0) return { success: false, errors };
  const cfg = await readConfig();
  cfg.elementStyles = next;
  await writeConfig(cfg);
  return { success: true };
}

export async function replaceStyleRules(next: StyleRule[]): Promise<{ success: boolean; errors?: string[] }> {
  if (!Array.isArray(next)) return { success: false, errors: ['Body must be an array of style rules'] };
  const cfg = await readConfig();
  // Rules may reference styles defined in the same config; validate against them.
  const known = (Array.isArray(cfg.elementStyles) ? cfg.elementStyles : []).map((s) => s.name);
  const errors = validateStyleRules(next, known);
  if (errors.length > 0) return { success: false, errors };
  cfg.styleRules = next;
  await writeConfig(cfg);
  return { success: true };
}

/**
 * Replace the full `types[]` list. Validates each entry and rejects the
 * write on duplicate names or circular derivation.
 */
export async function replaceDerivedTypes(next: DerivedType[]): Promise<{ success: boolean; errors?: string[] }> {
  const errors = validateDerivedTypes(next);
  if (errors.length > 0) return { success: false, errors };
  const cfg = await readConfig();
  cfg.types = next;
  await writeConfig(cfg);
  return { success: true };
}

/**
 * Structural + graph validation of a derived-types array.
 *  - Each entry has a valid kebab-name and non-empty `basedOn`.
 *  - No duplicate names.
 *  - `basedOn` points at either a standard type or another derived type.
 *  - The derivation graph is acyclic.
 */
export function validateDerivedTypes(types: DerivedType[]): string[] {
  const errors: string[] = [];
  const byName = new Map<string, DerivedType>();

  for (const t of types) {
    if (!t?.name || typeof t.name !== 'string') {
      errors.push('Each derived type must have a `name` string');
      continue;
    }
    if (STANDARD_TYPES.has(t.name)) {
      errors.push(`Derived type name '${t.name}' shadows a standard AttributeType`);
    }
    if (byName.has(t.name)) {
      errors.push(`Duplicate derived type name: '${t.name}'`);
    } else {
      byName.set(t.name, t);
    }
    if (!t.basedOn || typeof t.basedOn !== 'string') {
      errors.push(`Derived type '${t.name}' must declare a \`basedOn\``);
    }
    if (t.domain) errors.push(...validateDomain(t.name, t.domain));
  }

  // Resolve each chain; detect unknown references and cycles
  for (const t of types) {
    if (!t?.name || !t?.basedOn) continue;
    const visited = new Set<string>();
    let cursor: string | undefined = t.basedOn;
    while (cursor && !STANDARD_TYPES.has(cursor)) {
      if (visited.has(cursor)) {
        errors.push(`Circular derivation starting at '${t.name}' (cycle via '${cursor}')`);
        break;
      }
      visited.add(cursor);
      const next = byName.get(cursor);
      if (!next) {
        errors.push(`Derived type '${t.name}' references unknown type '${cursor}'`);
        break;
      }
      cursor = next.basedOn;
    }
  }

  return errors;
}

/**
 * Per-kind validation of a {@link ValueDomain}:
 *  - enum      → non-empty `values`; no `source`.
 *  - codelist  → `source` required; `values` optional (the static codes).
 *  - reference → `source` required; no inline `values` (they come from the source).
 */
export function validateDomain(typeName: string, domain: ValueDomain): string[] {
  const errors: string[] = [];
  if (!DOMAIN_KINDS.has(domain.kind)) {
    errors.push(`Derived type '${typeName}' has invalid domain kind '${domain.kind}'`);
    return errors;
  }
  const hasValues = Array.isArray(domain.values) && domain.values.length > 0;
  const hasSource = typeof domain.source === 'string' && domain.source.trim().length > 0;

  if (domain.kind === 'enum') {
    if (!hasValues) errors.push(`Enum domain '${typeName}' must list at least one value`);
    if (hasSource) errors.push(`Enum domain '${typeName}' must not declare a \`source\``);
  } else if (domain.kind === 'codelist') {
    if (!hasSource) errors.push(`Codelist domain '${typeName}' must declare a \`source\` name`);
  } else if (domain.kind === 'reference') {
    if (!hasSource) errors.push(`Reference domain '${typeName}' must declare a \`source\` name`);
    if (hasValues) errors.push(`Reference domain '${typeName}' must not carry inline \`values\` (they come from the source)`);
  }
  return errors;
}

/**
 * Resolve the effective {@link ValueDomain} for an attribute's `type` — the
 * domain of the most-derived type in the chain that declares one. Returns
 * `null` for standard types, unknown types, or a chain with no domain.
 */
export function resolveDomain(typeName: string, derivedTypes: DerivedType[]): ValueDomain | null {
  if (STANDARD_TYPES.has(typeName)) return null;
  const byName = new Map(derivedTypes.map(t => [t.name, t] as const));
  const visited = new Set<string>();
  let cursor: string = typeName;
  while (!STANDARD_TYPES.has(cursor)) {
    if (visited.has(cursor)) return null; // cycle
    visited.add(cursor);
    const dt = byName.get(cursor);
    if (!dt) return null;
    if (dt.domain) return dt.domain;
    cursor = dt.basedOn;
  }
  return null;
}

/**
 * Resolve an attribute's `type` string to its terminal standard type plus
 * the merged chain of `validation` fields. Derived validations merge from
 * base → derived (base wins where the derived type does not override).
 *
 * Returns `null` if the type cannot be resolved — caller should treat
 * this as "unknown" (e.g. skip validation merging) rather than fail.
 */
export function resolveAttributeType(
  typeName: string,
  derivedTypes: DerivedType[],
): { baseType: AttributeType; validation: AttributeValidation } | null {
  if (STANDARD_TYPES.has(typeName)) {
    return { baseType: typeName as AttributeType, validation: {} };
  }

  const byName = new Map(derivedTypes.map(t => [t.name, t] as const));
  const chain: DerivedType[] = [];
  const visited = new Set<string>();
  let cursor: string = typeName;

  while (!STANDARD_TYPES.has(cursor)) {
    if (visited.has(cursor)) return null; // cycle — caller treats as unknown
    visited.add(cursor);
    const dt = byName.get(cursor);
    if (!dt) return null;
    chain.push(dt);
    cursor = dt.basedOn;
  }

  // cursor is now a standard AttributeType. Merge validations from
  // base (end of chain) toward the leaf so the most-derived wins.
  const merged: AttributeValidation = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    Object.assign(merged, chain[i].validation || {});
  }

  return { baseType: cursor as AttributeType, validation: merged };
}
