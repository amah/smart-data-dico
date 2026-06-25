/**
 * Action service (#179) — CRUD for Action objects.
 *
 * Actions are stored in the multi-kind YAML loader as `actions:` sections.
 * Each action is owned by an entity (ownerRef = entity UUID).
 *
 * Persistence strategy (mirrors ruleService):
 *   - On write: first try to place the action in the owner entity's existing
 *     model file; fallback is a dedicated `<name>.actions.yaml` file.
 *   - On read: scan all packages via `loadPackage()` and filter by ownerRef.
 *   - On delete: scan for the owning file and remove.
 */

import { Action, FLOW_STEP_KINDS, ACTION_KINDS } from '../models/Action.js';
import type { FlowStep } from '../models/Action.js';
import {
  readActionsForEntity,
  readActionsForPackage,
  writeAction,
  deleteAction as deleteActionFile,
  findActionOwner,
  loadPackage,
  listPackages,
  type PackageModel,
} from '../utils/fileOperations.js';
import { generateUUID } from '../utils/uuid.js';
import { logger } from '../utils/logger.js';

// ── Validation ────────────────────────────────────────────────────────────────

export interface ActionValidationError {
  field: string;
  message: string;
}

/**
 * Recursively collect errors from invokeAction steps within a step list.
 * Checks that every `invokeAction.actionRef` resolves to a known action UUID.
 */
function checkInvokeRefs(
  steps: FlowStep[],
  knownActionUuids: Set<string>,
  pathPrefix: string,
  errors: ActionValidationError[],
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const path = `${pathPrefix}[${i}]`;
    if (step.kind === 'invokeAction') {
      if (!knownActionUuids.has(step.actionRef)) {
        errors.push({
          field: `${path}.actionRef`,
          message: `invokeAction references unknown action UUID '${step.actionRef}' at ${path}`,
        });
      }
    } else if (step.kind === 'branch') {
      if (step.then && step.then.length > 0) {
        checkInvokeRefs(step.then, knownActionUuids, `${path}.then`, errors);
      }
      if (step.else && step.else.length > 0) {
        checkInvokeRefs(step.else, knownActionUuids, `${path}.else`, errors);
      }
    }
  }
}

/**
 * Recursively collect errors from emitEvent / wait steps that carry an
 * `eventRef`. A set `eventRef` must resolve to a known event UUID; an absent
 * one is fine (the opaque name / for string is the fallback). (#201 Phase 2)
 */
function checkEventRefs(
  steps: FlowStep[],
  knownEventUuids: Set<string>,
  pathPrefix: string,
  errors: ActionValidationError[],
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const path = `${pathPrefix}[${i}]`;
    if (step.kind === 'emitEvent' || step.kind === 'wait') {
      if (step.eventRef && !knownEventUuids.has(step.eventRef)) {
        errors.push({
          field: `${path}.eventRef`,
          message: `${step.kind} references unknown event UUID '${step.eventRef}' at ${path}`,
        });
      }
    } else if (step.kind === 'branch') {
      if (step.then && step.then.length > 0) {
        checkEventRefs(step.then, knownEventUuids, `${path}.then`, errors);
      }
      if (step.else && step.else.length > 0) {
        checkEventRefs(step.else, knownEventUuids, `${path}.else`, errors);
      }
    }
  }
}

/** Validate an action's structure before write. */
export function validateAction(
  action: Partial<Action>,
  knownActionUuids?: Set<string>,
  knownEventUuids?: Set<string>,
): ActionValidationError[] {
  const errors: ActionValidationError[] = [];

  if (!action.uuid) errors.push({ field: 'uuid', message: 'uuid is required' });
  if (!action.name) errors.push({ field: 'name', message: 'name is required' });
  if (!action.ownerRef) errors.push({ field: 'ownerRef', message: 'ownerRef is required' });

  // CQRS classification (#201 Phase 3) — optional, but must be a known kind.
  if (action.actionKind !== undefined && !ACTION_KINDS.has(action.actionKind)) {
    errors.push({
      field: 'actionKind',
      message: `Invalid actionKind '${action.actionKind}'. Must be one of: ${[...ACTION_KINDS].join(', ')}`,
    });
  }

  // Validate param name uniqueness
  if (action.params && action.params.length > 0) {
    const names = action.params.map(p => p.name);
    const unique = new Set(names);
    if (unique.size !== names.length) {
      errors.push({ field: 'params', message: 'Action params must have unique names' });
    }
    for (const p of action.params) {
      if (!p.name) errors.push({ field: 'params', message: 'Each param must have a name' });
      if (!p.type) errors.push({ field: 'params', message: `Param '${p.name}' must have a type` });
    }
  }

  // Validate flow step kinds
  if (action.flow) {
    for (let i = 0; i < action.flow.length; i++) {
      const step = action.flow[i];
      if (!step.kind || !FLOW_STEP_KINDS.has(step.kind)) {
        errors.push({
          field: `flow[${i}].kind`,
          message: `Invalid flow step kind '${step.kind}'. Must be one of: ${[...FLOW_STEP_KINDS].join(', ')}`,
        });
      }
    }

    // Cross-reference: invokeAction.actionRef must resolve to a known action UUID (spec AC 5)
    if (knownActionUuids !== undefined) {
      checkInvokeRefs(action.flow, knownActionUuids, 'flow', errors);
    }

    // Cross-reference: emitEvent/wait `eventRef` (when set) must resolve to a
    // known event UUID in the package (#201 Phase 2).
    if (knownEventUuids !== undefined) {
      checkEventRefs(action.flow, knownEventUuids, 'flow', errors);
    }
  }

  return errors;
}

// ── Service class ─────────────────────────────────────────────────────────────

class ActionService {
  /** List all actions. Optionally filter by ownerRef (entity UUID) or package. */
  async list(filters: { ownerRef?: string; packageName?: string } = {}): Promise<Action[]> {
    try {
      if (filters.ownerRef) {
        return await readActionsForEntity(filters.ownerRef);
      }
      if (filters.packageName) {
        return await readActionsForPackage(filters.packageName);
      }

      // Full scan across all packages
      const packages = await listPackages();
      const result: Action[] = [];
      for (const pkg of packages) {
        const model = await loadPackage(pkg);
        result.push(...model.actions);
      }
      return result;
    } catch (error) {
      logger.error(`Error listing actions: ${error}`);
      return [];
    }
  }

  /** Get one action by UUID. */
  async getByUuid(uuid: string): Promise<Action | null> {
    try {
      const owner = await findActionOwner(uuid);
      if (!owner) return null;
      const model = await loadPackage(owner.packageName);
      return model.actions.find(a => a.uuid === uuid) ?? null;
    } catch (error) {
      logger.error(`Error getting action ${uuid}: ${error}`);
      return null;
    }
  }

  /**
   * Create a new action. `ownerRef` must point to an existing entity UUID.
   * Returns the created action or a validation error list.
   */
  async create(data: Partial<Action>): Promise<Action | { errors: ActionValidationError[] }> {
    const action: Action = {
      uuid: data.uuid || generateUUID(),
      name: data.name || '',
      description: data.description,
      ownerRef: data.ownerRef || '',
      internal: data.internal ?? false,
      actionKind: data.actionKind,
      params: data.params ?? [],
      returns: data.returns,
      flow: data.flow ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Resolve the owning package to get known action UUIDs for cross-ref validation
    const { packageModel, packageName } = await this.resolvePackageContext(action.ownerRef);
    if (!packageModel || !packageName) {
      return { errors: [{ field: 'ownerRef', message: `Entity '${action.ownerRef}' not found in any package` }] };
    }

    // Include the action being created itself so self-invoke doesn't produce a false positive
    const knownActionUuids = new Set(packageModel.ownership.actionByUuid.keys());
    knownActionUuids.add(action.uuid);
    const knownEventUuids = new Set(packageModel.ownership.eventByUuid.keys());

    const errors = validateAction(action, knownActionUuids, knownEventUuids);
    if (errors.length > 0) return { errors };

    const result = await writeAction(action, packageName);
    if (!result.ok) {
      return { errors: [{ field: '_', message: 'Failed to persist action' }] };
    }

    return action;
  }

  /**
   * Update an existing action.
   */
  async update(uuid: string, data: Partial<Action>): Promise<Action | { errors: ActionValidationError[] } | null> {
    const existing = await this.getByUuid(uuid);
    if (!existing) return null;

    const updated: Action = {
      ...existing,
      ...data,
      uuid,
      updatedAt: new Date().toISOString(),
    };

    // Resolve the owning package to get known action UUIDs for cross-ref validation
    const { packageModel, packageName } = await this.resolvePackageContext(updated.ownerRef);
    if (!packageModel || !packageName) {
      return { errors: [{ field: 'ownerRef', message: `Entity '${updated.ownerRef}' not found in any package` }] };
    }

    const knownActionUuids = new Set(packageModel.ownership.actionByUuid.keys());
    // Ensure the action itself is in the set (it's already on disk, so it should be)
    knownActionUuids.add(uuid);
    const knownEventUuids = new Set(packageModel.ownership.eventByUuid.keys());

    const errors = validateAction(updated, knownActionUuids, knownEventUuids);
    if (errors.length > 0) return { errors };

    const result = await writeAction(updated, packageName);
    if (!result.ok) {
      return { errors: [{ field: '_', message: 'Failed to persist action' }] };
    }

    return updated;
  }

  /**
   * Delete an action by UUID.
   */
  async delete(uuid: string): Promise<boolean> {
    const result = await deleteActionFile(uuid);
    return result.ok;
  }

  /** Find the package and loaded model for the entity with the given UUID. */
  private async resolvePackageContext(entityUuid: string): Promise<{ packageModel: PackageModel | null; packageName: string | null }> {
    const packages = await listPackages();
    for (const pkg of packages) {
      const model = await loadPackage(pkg);
      if (model.ownership.entityByUuid.has(entityUuid)) {
        return { packageModel: model, packageName: pkg };
      }
    }
    return { packageModel: null, packageName: null };
  }
}

export const actionService = new ActionService();
