/**
 * State machine service (#179) — CRUD for StateMachine objects.
 *
 * State machines are stored in the multi-kind YAML loader as `stateMachines:`
 * sections. Each machine is owned by an entity (ownerRef = entity UUID).
 *
 * Persistence mirrors actionService.
 */

import { StateMachine } from '../models/StateMachine.js';
import {
  readStateMachinesForEntity,
  writeStateMachine,
  deleteStateMachine as deleteStateMachineFile,
  findStateMachineOwner,
  loadPackage,
  listPackages,
  type PackageModel,
} from '../utils/fileOperations.js';
import { generateUUID } from '../utils/uuid.js';
import { logger } from '../utils/logger.js';

// ── Validation ────────────────────────────────────────────────────────────────

export interface StateMachineValidationError {
  field: string;
  message: string;
}

export function validateStateMachine(
  sm: Partial<StateMachine>,
  knownActionUuids?: Set<string>,
  ownerAttributes?: string[],
): StateMachineValidationError[] {
  const errors: StateMachineValidationError[] = [];

  if (!sm.uuid) errors.push({ field: 'uuid', message: 'uuid is required' });
  if (!sm.name) errors.push({ field: 'name', message: 'name is required' });
  if (!sm.ownerRef) errors.push({ field: 'ownerRef', message: 'ownerRef is required' });
  if (!sm.initialState) errors.push({ field: 'initialState', message: 'initialState is required' });

  if (!sm.states || sm.states.length === 0) {
    errors.push({ field: 'states', message: 'At least one state is required' });
  }

  // stateAttribute must match an attribute on the owner entity
  if (sm.stateAttribute && ownerAttributes !== undefined) {
    if (!ownerAttributes.includes(sm.stateAttribute)) {
      errors.push({
        field: 'stateAttribute',
        message: `stateAttribute '${sm.stateAttribute}' is not an attribute on the owner entity`,
      });
    }
  }

  if (sm.states && sm.states.length > 0 && sm.initialState) {
    const stateNames = new Set(sm.states.map(s => s.name));

    // State names must be unique within the machine
    if (stateNames.size !== sm.states.length) {
      errors.push({ field: 'states', message: 'State names must be unique within a state machine' });
    }

    // initialState must be a declared state
    if (!stateNames.has(sm.initialState)) {
      errors.push({ field: 'initialState', message: `initialState '${sm.initialState}' is not a declared state` });
    }

    // Validate transitions
    if (sm.transitions) {
      const transitionUuids = new Set<string>();
      for (let i = 0; i < sm.transitions.length; i++) {
        const t = sm.transitions[i];
        if (!t.uuid) {
          errors.push({ field: `transitions[${i}].uuid`, message: 'Transition uuid is required' });
        } else if (transitionUuids.has(t.uuid)) {
          errors.push({ field: `transitions[${i}].uuid`, message: `Duplicate transition uuid '${t.uuid}'` });
        } else {
          transitionUuids.add(t.uuid);
        }

        if (!t.from) {
          errors.push({ field: `transitions[${i}].from`, message: 'Transition from is required' });
        } else if (t.from !== '*' && !stateNames.has(t.from)) {
          errors.push({
            field: `transitions[${i}].from`,
            message: `Transition from '${t.from}' is not a declared state (use "*" for wildcard)`,
          });
        }

        if (!t.to) {
          errors.push({ field: `transitions[${i}].to`, message: 'Transition to is required' });
        } else if (!stateNames.has(t.to)) {
          errors.push({
            field: `transitions[${i}].to`,
            message: `Transition to '${t.to}' is not a declared state`,
          });
        }

        if (!t.on) {
          errors.push({ field: `transitions[${i}].on`, message: 'Transition event (on) is required' });
        }

        // invoke[] UUIDs must resolve to known actions (spec AC 5)
        if (knownActionUuids !== undefined && t.invoke) {
          for (const actionUuid of t.invoke) {
            if (!knownActionUuids.has(actionUuid)) {
              errors.push({
                field: `transitions[${i}].invoke`,
                message: `invoke references unknown action UUID '${actionUuid}' in transition '${t.uuid}'`,
              });
            }
          }
        }
      }
    }
  }

  return errors;
}

// ── Service class ─────────────────────────────────────────────────────────────

class StateMachineService {
  /** List all state machines. Optionally filter by ownerRef (entity UUID). */
  async list(filters: { ownerRef?: string } = {}): Promise<StateMachine[]> {
    try {
      if (filters.ownerRef) {
        return await readStateMachinesForEntity(filters.ownerRef);
      }

      const packages = await listPackages();
      const result: StateMachine[] = [];
      for (const pkg of packages) {
        const model = await loadPackage(pkg);
        result.push(...model.stateMachines);
      }
      return result;
    } catch (error) {
      logger.error(`Error listing state machines: ${error}`);
      return [];
    }
  }

  /** Get one state machine by UUID. */
  async getByUuid(uuid: string): Promise<StateMachine | null> {
    try {
      const owner = await findStateMachineOwner(uuid);
      if (!owner) return null;
      const model = await loadPackage(owner.packageName);
      return model.stateMachines.find(m => m.uuid === uuid) ?? null;
    } catch (error) {
      logger.error(`Error getting stateMachine ${uuid}: ${error}`);
      return null;
    }
  }

  /**
   * Create a new state machine.
   */
  async create(data: Partial<StateMachine>): Promise<StateMachine | { errors: StateMachineValidationError[] }> {
    const sm: StateMachine = {
      uuid: data.uuid || generateUUID(),
      name: data.name || '',
      description: data.description,
      ownerRef: data.ownerRef || '',
      stateAttribute: data.stateAttribute,
      initialState: data.initialState || '',
      states: data.states ?? [],
      transitions: data.transitions ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Resolve package first to get known action UUIDs and owner attributes for cross-ref validation
    const { packageModel, packageName } = await this.resolvePackageContext(sm.ownerRef);
    if (!packageModel || !packageName) {
      return { errors: [{ field: 'ownerRef', message: `Entity '${sm.ownerRef}' not found in any package` }] };
    }

    const knownActionUuids = new Set(packageModel.ownership.actionByUuid.keys());
    const ownerEntity = packageModel.entities.find(e => e.uuid === sm.ownerRef);
    const ownerAttributes = ownerEntity?.attributes?.map(a => a.name) ?? [];

    const errors = validateStateMachine(sm, knownActionUuids, ownerAttributes);
    if (errors.length > 0) return { errors };

    const result = await writeStateMachine(sm, packageName);
    if (!result.ok) {
      return { errors: [{ field: '_', message: 'Failed to persist state machine' }] };
    }

    return sm;
  }

  /**
   * Update an existing state machine.
   */
  async update(uuid: string, data: Partial<StateMachine>): Promise<StateMachine | { errors: StateMachineValidationError[] } | null> {
    const existing = await this.getByUuid(uuid);
    if (!existing) return null;

    const updated: StateMachine = {
      ...existing,
      ...data,
      uuid,
      updatedAt: new Date().toISOString(),
    };

    // Resolve package to get known action UUIDs and owner attributes for cross-ref validation
    const { packageModel, packageName } = await this.resolvePackageContext(updated.ownerRef);
    if (!packageModel || !packageName) {
      return { errors: [{ field: 'ownerRef', message: `Entity '${updated.ownerRef}' not found in any package` }] };
    }

    const knownActionUuids = new Set(packageModel.ownership.actionByUuid.keys());
    const ownerEntity = packageModel.entities.find(e => e.uuid === updated.ownerRef);
    const ownerAttributes = ownerEntity?.attributes?.map(a => a.name) ?? [];

    const errors = validateStateMachine(updated, knownActionUuids, ownerAttributes);
    if (errors.length > 0) return { errors };

    const result = await writeStateMachine(updated, packageName);
    if (!result.ok) {
      return { errors: [{ field: '_', message: 'Failed to persist state machine' }] };
    }

    return updated;
  }

  /**
   * Delete a state machine by UUID.
   */
  async delete(uuid: string): Promise<boolean> {
    const result = await deleteStateMachineFile(uuid);
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

export const stateMachineService = new StateMachineService();
