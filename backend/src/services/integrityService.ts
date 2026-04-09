/**
 * Integrity service (#85 R5).
 *
 * Aggregates everything that constrains or validates the data into one
 * unified read endpoint, behind a single cache key. The Integrity page
 * (`/integrity`) renders this payload behind 4 tabs (All / Validation /
 * Constraints / Rules) so users have one pane of glass for all three
 * concepts at once.
 *
 * The three concepts are kept strictly separate at the storage layer
 * (see CLAUDE.md "Validation / Constraint / Rule") — this service does
 * NOT mix them. It just emits three flat lists from the same walk:
 *
 *   - validation: { entityName, attributeName, kind, value, … }
 *   - constraints: PhysicalConstraint + entity context
 *   - rules: Rule[] from all three storage scopes
 *
 * Pure read, no side effects, no caching here (the controller is small
 * enough that the frontend can derive per-tab counts in useMemo and the
 * full payload is small even for large dictionaries).
 */
import { Entity, Attribute, PhysicalConstraint } from '../models/EntitySchema.js';
import { Rule } from '../models/Rule.js';
import { listAllEntities, readEntityFile } from '../utils/fileOperations.js';
import { ruleService } from './ruleService.js';
import { logger } from '../utils/logger.js';

/** A single validation field on an attribute, flattened for the Integrity grid. */
export interface ValidationItem {
  service: string;
  entityUuid: string;
  entityName: string;
  attributeUuid: string;
  attributeName: string;
  /** Which validation kind this row describes. Maps to one field on AttributeValidation. */
  kind:
    | 'minLength' | 'maxLength' | 'pattern' | 'format'
    | 'minimum' | 'maximum' | 'precision' | 'scale'
    | 'enumValues';
  /** The configured value (number, string, or string[] for enumValues). */
  value: number | string | string[];
}

/** A physical constraint with its containing-entity context. */
export interface ConstraintItem {
  service: string;
  entityUuid: string;
  entityName: string;
  /** The PhysicalConstraint payload — kind / name / columns / expression / references. */
  constraint: PhysicalConstraint;
}

/** Aggregated payload returned by GET /api/integrity. */
export interface IntegrityReport {
  validation: ValidationItem[];
  constraints: ConstraintItem[];
  rules: Rule[];
}

/** Validation field name → ValidationItem.kind, mirrors AttributeValidation. */
const VALIDATION_KINDS: ValidationItem['kind'][] = [
  'minLength', 'maxLength', 'pattern', 'format',
  'minimum', 'maximum', 'precision', 'scale',
  'enumValues',
];

/**
 * Walk one entity and emit ValidationItem rows for every present field
 * on every attribute. Skips attributes without a validation block (zero
 * rows for that attribute). Pure — no I/O.
 */
function validationItemsFromEntity(service: string, entity: Entity): ValidationItem[] {
  const out: ValidationItem[] = [];
  for (const attr of entity.attributes || []) {
    const v = attr.validation;
    if (!v) continue;
    for (const kind of VALIDATION_KINDS) {
      const value = v[kind];
      if (value === undefined || value === null) continue;
      out.push({
        service,
        entityUuid: entity.uuid,
        entityName: entity.name,
        attributeUuid: attr.uuid,
        attributeName: attr.name,
        kind,
        value: value as number | string | string[],
      });
    }
  }
  return out;
}

/** Walk one entity and emit ConstraintItem rows from `entity.constraints`. */
function constraintItemsFromEntity(service: string, entity: Entity): ConstraintItem[] {
  const cs = entity.constraints || [];
  return cs.map(constraint => ({
    service,
    entityUuid: entity.uuid,
    entityName: entity.name,
    constraint,
  }));
}

class IntegrityService {
  /**
   * Build the unified Integrity payload.
   *
   * Reads every entity in every microservice exactly once, derives the
   * validation + constraint lists in-process, and joins with the
   * existing ruleService for the third list. No filtering — the
   * frontend handles that in useMemo.
   */
  async getReport(): Promise<IntegrityReport> {
    const validation: ValidationItem[] = [];
    const constraints: ConstraintItem[] = [];

    try {
      const entityRefs = await listAllEntities();
      for (const ref of entityRefs) {
        const entity = await readEntityFile(ref.microservice, ref.name);
        if (!entity) continue;
        validation.push(...validationItemsFromEntity(ref.microservice, entity));
        constraints.push(...constraintItemsFromEntity(ref.microservice, entity));
      }
    } catch (error) {
      logger.error(`Error walking entities for integrity report: ${error}`);
    }

    let rules: Rule[] = [];
    try {
      rules = await ruleService.listRules();
    } catch (error) {
      logger.error(`Error listing rules for integrity report: ${error}`);
    }

    return { validation, constraints, rules };
  }
}

export const integrityService = new IntegrityService();

// Re-export the pure helpers so tests can exercise them without mocking
// the file system layer.
export { validationItemsFromEntity, constraintItemsFromEntity };
