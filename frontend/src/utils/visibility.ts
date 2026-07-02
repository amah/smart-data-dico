/**
 * Client-side mirror of the backend hide policy (#hide-model-data) for views that
 * load entities via package data rather than the filtered REST endpoint. An entity
 * is hidden if it carries `system.hidden: "true"` (or matches a hide rule), unless
 * pinned visible with `system.hidden: "false"`. Keep in sync with the backend
 * `visibilityService`.
 */
import type { HideRule } from '../services/api';

export const HIDDEN_META_KEY = 'system.hidden';

interface MetaEntry { name: string; value: unknown }
interface HidableEntity { name?: string; metadata?: MetaEntry[] }

function metaValue(metadata: MetaEntry[] | undefined, key: string): string | undefined {
  const hit = metadata?.find((m) => m.name === key);
  return hit == null ? undefined : String(hit.value);
}

function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, 'i');
}

export interface CompiledRule { match: HideRule['match']; re: RegExp }

export function compileHideRules(rules: HideRule[] | undefined): CompiledRule[] {
  const out: CompiledRule[] = [];
  for (const r of rules ?? []) {
    if (!r?.pattern || !r.match) continue;
    try { out.push({ match: r.match, re: r.regex ? new RegExp(r.pattern, 'i') : globToRegExp(r.pattern) }); }
    catch { /* skip invalid regex */ }
  }
  return out;
}

/** Whether an entity is effectively hidden (explicit flag wins; else rules). */
export function isEntityHidden(entity: HidableEntity, rules: CompiledRule[], packageName?: string): boolean {
  const flag = metaValue(entity.metadata, HIDDEN_META_KEY);
  if (flag === 'false') return false;
  if (flag === 'true') return true;
  const targets: Record<HideRule['match'], string | undefined> = {
    entityName: entity.name,
    physicalTableName: metaValue(entity.metadata, 'physical.tableName'),
    packageName,
  };
  return rules.some((r) => { const t = targets[r.match]; return !!t && r.re.test(t); });
}
