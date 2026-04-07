/**
 * Constraint → Rule synthesis (#76).
 *
 * Reframes the existing `attribute.constraints` field as a structured,
 * database-flavored case of Rule. Each present constraint becomes a virtual
 * Rule at read time, so the rule browser, the per-attribute rule list, and
 * the entity Rules tab all see the full picture of what's enforced on an
 * attribute — without a destructive on-disk migration.
 *
 * Synthetic rules:
 *   - have UUIDs prefixed `constraint:` so consumers can detect them
 *   - carry `synthetic: true` and `constraintField: <field name>`
 *   - default to `enforcement: 'save'` and `severity: 'error'` (DB-level integrity)
 *   - are read-only — write handlers in ruleService reject `constraint:` UUIDs
 *
 * v2 may add a "promote constraint to real rule" action that copies the
 * synthetic into entity-sidecar storage and clears the underlying constraint.
 */
import { Entity } from '../models/EntitySchema.js';
import { Rule } from '../models/Rule.js';

/** Build a stable virtual UUID for a constraint-derived rule. */
export function constraintRuleUuid(attrUuid: string, field: string): string {
  return `constraint:${attrUuid}:${field}`;
}

/**
 * Synthesize virtual rules from an entity's attribute constraints.
 *
 * Walks `entity.attributes[*].constraints` and emits one Rule per present
 * constraint field. Returns an empty array if the entity has no constraints.
 */
export function synthesizeConstraintRules(entity: Entity): Rule[] {
  const rules: Rule[] = [];
  if (!entity || !entity.attributes) return rules;

  for (const attr of entity.attributes) {
    if (!attr.constraints) continue;
    const c = attr.constraints;
    const baseTarget = {
      kind: 'attribute' as const,
      uuid: attr.uuid,
      entityUuid: entity.uuid,
    };
    const baseTags = ['constraint', 'data-consistency'];
    const make = (
      shortName: string,
      field: string,
      description: string,
    ): Rule => ({
      uuid: constraintRuleUuid(attr.uuid, field),
      name: shortName,
      description,
      severity: 'error',
      enforcement: 'save',
      scope: 'entity',
      entityUuid: entity.uuid,
      targets: [baseTarget],
      tags: baseTags,
      synthetic: true,
      constraintField: field,
    });

    if (c.format) {
      rules.push(make('format', 'format', `Must be a valid \`${c.format}\``));
    }
    if (c.minLength != null) {
      rules.push(make('min-length', 'minLength', `Length must be ≥ ${c.minLength}`));
    }
    if (c.maxLength != null) {
      rules.push(make('max-length', 'maxLength', `Length must be ≤ ${c.maxLength}`));
    }
    if (c.minimum != null) {
      rules.push(make('minimum', 'minimum', `Value must be ≥ ${c.minimum}`));
    }
    if (c.maximum != null) {
      rules.push(make('maximum', 'maximum', `Value must be ≤ ${c.maximum}`));
    }
    if (c.pattern) {
      rules.push(make('pattern', 'pattern', `Must match \`${c.pattern}\``));
    }
    if (c.enumValues && c.enumValues.length > 0) {
      rules.push(
        make('enum', 'enumValues', `Must be one of: ${c.enumValues.join(', ')}`),
      );
    }
  }

  return rules;
}
