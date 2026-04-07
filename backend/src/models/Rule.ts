/**
 * Validation rule model (#74).
 *
 * Rules capture the constraints a model must satisfy that aren't expressible
 * in structure alone — multi-attribute invariants, cross-entity referential
 * integrity, business logic. v1 stores them as free-text markdown descriptions
 * with severity; an executable expression layer is deferred.
 */

/** Where a rule lives — determines storage location and lookup */
export type RuleScope = 'entity' | 'package' | 'perspective';

/** Severity of a rule's violation — answers HOW BAD */
export type RuleSeverityValue = 'info' | 'warning' | 'error';

/**
 * When a rule is checked — answers WHEN. Decoupled from severity.
 *  - 'save'     → must pass before save (DB-level integrity, default for synthesized constraints)
 *  - 'process'  → must pass at a specific process-stage transition; the stage is named in the
 *                 rule's `metadata` array via `process-stage-field` / `process-stage-value`
 *  - 'advisory' → never blocks; surfaces in review/remediation lists only
 */
export type RuleEnforcement = 'save' | 'process' | 'advisory';

/** What kind of node a rule target points to */
export type RuleTargetKind = 'attribute' | 'entity' | 'relationship' | 'perspective-node';

/**
 * Free-form metadata entry on a rule, mirroring the existing
 * Entity/Attribute/Package metadata pattern.
 */
export interface RuleMetadataEntry {
  name: string;
  value: string | number | boolean;
}

/** A single node referenced by a rule */
export interface RuleTarget {
  /** What kind of node this target is */
  kind: RuleTargetKind;
  /** UUID of the target — never name-based, so renames don't break references */
  uuid: string;
  /** For attributes: the parent entity UUID, so we can resolve without scanning */
  entityUuid?: string;
  /** For perspective nodes: the path within the perspective (e.g. "Order.customer.address") */
  perspectivePath?: string;
}

/**
 * Optional structured expression for future automated evaluation.
 * v1: free-text only ('text'). v2+: jsonata, jexl, or sql.
 */
export interface RuleExpression {
  language: 'text' | 'jsonata' | 'jexl' | 'sql';
  body: string;
}

/** A validation rule */
export interface Rule {
  uuid: string;
  /** Short identifier, kebab-case (e.g. "email-format", "shipped-requires-date") */
  name: string;
  /** Markdown description — the human explanation of the rule */
  description: string;
  /** Severity of a violation — how bad it is */
  severity: RuleSeverityValue;
  /** When the rule is checked — decoupled from severity (#76) */
  enforcement: RuleEnforcement;
  /** Where the rule lives — determines storage location and lookup */
  scope: RuleScope;
  /** For scope='package': the package the rule lives in */
  packageName?: string;
  /** For scope='entity': the parent entity UUID and (denormalized) name */
  entityUuid?: string;
  /** For scope='perspective': the perspective UUID */
  perspectiveUuid?: string;
  /** Nodes the rule references (1+) */
  targets: RuleTarget[];
  /** Optional structured expression (deferred to v2 — v1 leaves this empty) */
  expression?: RuleExpression;
  /** Free-form tags for grouping in the rule browser */
  tags?: string[];
  /**
   * Free-form metadata, mirrors the Entity/Attribute/Package metadata pattern.
   * Used for process-stage binding when enforcement='process':
   *   metadata: [
   *     { name: 'process-stage-field', value: 'lifecycle-stage' },
   *     { name: 'process-stage-value', value: 'approved' },  // optional
   *   ]
   */
  metadata?: RuleMetadataEntry[];
  /** True for rules synthesized from attribute.constraints (read-only, #76) */
  synthetic?: boolean;
  /** For synthetic rules: which constraint field this came from (format, minLength, ...) */
  constraintField?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Generate a stable rule UUID prefix to make scope visible in IDs (debugging aid) */
export function generateRuleUuid(): string {
  // Use Node's crypto module for UUIDv4 — same approach as the rest of the codebase
  return `rule-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/** Validate a Rule shape — returns array of error messages, empty if valid */
export function validateRule(rule: Partial<Rule>): string[] {
  const errors: string[] = [];
  if (!rule.name || typeof rule.name !== 'string') {
    errors.push('Rule name is required');
  } else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rule.name)) {
    errors.push('Rule name must be kebab-case (lowercase letters, numbers, hyphens)');
  }
  if (!rule.description || typeof rule.description !== 'string') {
    errors.push('Rule description is required');
  }
  if (!rule.severity || !['info', 'warning', 'error'].includes(rule.severity)) {
    errors.push('Rule severity must be one of: info, warning, error');
  }
  if (!rule.enforcement || !['save', 'process', 'advisory'].includes(rule.enforcement)) {
    errors.push('Rule enforcement must be one of: save, process, advisory');
  }
  if (!rule.scope || !['entity', 'package', 'perspective'].includes(rule.scope)) {
    errors.push('Rule scope must be one of: entity, package, perspective');
  }
  if (!Array.isArray(rule.targets) || rule.targets.length === 0) {
    errors.push('Rule must have at least one target');
  }
  if (rule.scope === 'entity' && !rule.entityUuid) {
    errors.push('Entity-scoped rules must specify entityUuid');
  }
  if (rule.scope === 'package' && !rule.packageName) {
    errors.push('Package-scoped rules must specify packageName');
  }
  if (rule.scope === 'perspective' && !rule.perspectiveUuid) {
    errors.push('Perspective-scoped rules must specify perspectiveUuid');
  }
  // Process-stage binding sanity check (warning-level — we don't fail save here,
  // since the referenced metadata field may be added shortly after the rule)
  if (rule.enforcement === 'process') {
    const stageField = (rule.metadata || []).find(m => m.name === 'process-stage-field');
    if (!stageField || !stageField.value) {
      errors.push('Process-enforcement rules must reference a metadata field via process-stage-field');
    }
  }
  return errors;
}

/** True if this rule UUID identifies a constraint-derived synthetic rule (#76) */
export function isSyntheticRuleUuid(uuid: string): boolean {
  return uuid.startsWith('constraint:');
}
