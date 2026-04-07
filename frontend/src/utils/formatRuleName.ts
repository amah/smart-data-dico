/**
 * Context-aware rule name formatter (#76).
 *
 * Storage uses canonical short names (`format`, `min-length`, `pattern`).
 * Display logic prefixes only when the surrounding context doesn't already
 * provide it. Examples:
 *
 *   - in attribute context: `format`
 *   - in entity context:    `email.format`
 *   - in global context:    `User.email.format`
 */
import type { Rule } from '../types';

export type RuleNameContext =
  /** Already inside the target attribute's UI (e.g. side panel scoped to attr) */
  | 'attribute'
  /** Inside the entity that owns the rule's target (e.g. entity Rules tab) */
  | 'entity'
  /** Anywhere — cross-entity, cross-package (e.g. /rules browser) */
  | 'global';

export interface RuleNameResolverContext {
  /** Resolves an attribute UUID to its name. Optional — falls back to "?" */
  attributeName?: (attrUuid: string) => string | undefined;
  /** Resolves an entity UUID to its name. Optional — falls back to "?" */
  entityName?: (entityUuid: string) => string | undefined;
}

/**
 * Format a rule's name for display, prefixing entity / attribute names only
 * when the caller's context doesn't already make them obvious.
 */
export function formatRuleName(
  rule: Rule,
  context: RuleNameContext,
  resolvers: RuleNameResolverContext = {},
): string {
  if (context === 'attribute') {
    // Caller is already showing the attribute — just the bare name.
    return rule.name;
  }

  // For entity / global, look at the rule's first target to derive the prefix.
  const target = rule.targets?.[0];
  if (!target) return rule.name;

  if (context === 'entity') {
    // We're already in entity context — only prefix the attribute name.
    if (target.kind === 'attribute' && target.uuid) {
      const attrName = resolvers.attributeName?.(target.uuid);
      return attrName ? `${attrName}.${rule.name}` : rule.name;
    }
    return rule.name;
  }

  // Global context: prefix entity (and attribute, if any).
  const entityUuid = target.entityUuid ?? (target.kind === 'entity' ? target.uuid : undefined);
  const entName = entityUuid ? resolvers.entityName?.(entityUuid) : undefined;

  if (target.kind === 'attribute' && target.uuid) {
    const attrName = resolvers.attributeName?.(target.uuid);
    if (entName && attrName) return `${entName}.${attrName}.${rule.name}`;
    if (attrName) return `${attrName}.${rule.name}`;
  }
  if (entName) return `${entName}.${rule.name}`;
  return rule.name;
}
