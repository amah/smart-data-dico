/**
 * Visibility (hide) policy for model elements (#hide-model-data).
 *
 * An element is *effectively hidden* to declutter the model — chiefly to suppress
 * reverse-engineering waste (backup / temp / staging tables) — without deleting it.
 * Hiding is a non-destructive view policy computed from two layers:
 *
 *   1. An explicit per-element flag: the reserved metadata key `system.hidden`
 *      (`"true"` hides, `"false"` PINS the element visible — an override that wins
 *      over any rule).
 *   2. Declarative `hideRules[]` in `dico.config.json` (glob or regex) matched
 *      against the element's physical table name, entity name, or package.
 *
 *   effectiveHidden = pinnedVisible ? false : (explicitHidden || matchesAnyRule)
 *
 * The single choke point: read paths call `filterHiddenEntities` (default) and
 * pass `includeHidden` only when the user explicitly asks to see hidden items.
 */
import type { Entity } from '../models/EntitySchema.js';
import type { HideRule } from './dicoConfigService.js';

export const HIDDEN_META_KEY = 'system.hidden';

/** Read a metadata value by key off an element's `metadata[]`. */
function metaValue(metadata: Array<{ name: string; value: unknown }> | undefined, key: string): string | undefined {
  const hit = metadata?.find((m) => m.name === key);
  return hit == null ? undefined : String(hit.value);
}

/** Convert a glob (`*`, `?`) to an anchored RegExp; other chars are escaped. */
function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, 'i');
}

export interface CompiledRule {
  match: HideRule['match'];
  re: RegExp;
  reason?: string;
}

/** Pre-compile hide rules to RegExps once per request. Invalid regexes are skipped. */
export function compileHideRules(rules: HideRule[] | undefined): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const r of rules ?? []) {
    if (!r?.pattern || !r.match) continue;
    try {
      out.push({ match: r.match, re: r.regex ? new RegExp(r.pattern, 'i') : globToRegExp(r.pattern), reason: r.reason });
    } catch { /* skip a rule with an invalid regex rather than failing the whole read */ }
  }
  return out;
}

/** The fields a rule can match against for a given entity + owning package. */
function entityMatchTargets(entity: Entity, packageName?: string): Record<HideRule['match'], string | undefined> {
  return {
    entityName: entity.name,
    physicalTableName: metaValue(entity.metadata, 'physical.tableName'),
    packageName,
  };
}

/**
 * Effective visibility for an entity. Returns whether it's hidden and, when a rule
 * caused it, the rule's reason (useful for the Hidden-Items manager / triage UI).
 */
export function entityHidden(entity: Entity, rules: CompiledRule[], packageName?: string): { hidden: boolean; reason?: string } {
  const flag = metaValue(entity.metadata, HIDDEN_META_KEY);
  if (flag === 'false') return { hidden: false };                 // pinned visible — wins over rules
  if (flag === 'true') return { hidden: true, reason: metaValue(entity.metadata, 'system.hiddenReason') };
  const targets = entityMatchTargets(entity, packageName);
  for (const r of rules) {
    const target = targets[r.match];
    if (target && r.re.test(target)) return { hidden: true, reason: r.reason ?? 'matched hide rule' };
  }
  return { hidden: false };
}

export const isEntityHidden = (entity: Entity, rules: CompiledRule[], packageName?: string): boolean =>
  entityHidden(entity, rules, packageName).hidden;

/** Filter a list of entities to the visible ones (unless `includeHidden`). */
export function filterHiddenEntities(entities: Entity[], rules: CompiledRule[], includeHidden: boolean, packageName?: string): Entity[] {
  if (includeHidden) return entities;
  return entities.filter((e) => !isEntityHidden(e, rules, packageName));
}

/** Whether a package (by name/path) is hidden by a `packageName` rule. */
export function isPackageHidden(packageName: string, rules: CompiledRule[]): boolean {
  return rules.some((r) => r.match === 'packageName' && r.re.test(packageName));
}
