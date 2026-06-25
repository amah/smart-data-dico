/**
 * Event service (#201 Phase 2) — CRUD for first-class Event objects.
 *
 * Events are stored in the multi-kind YAML loader as `events:` sections. They
 * are package-scoped; `ownerRef` (an entity UUID) is optional. Names are unique
 * within a package so the opaque emitEvent.name / wait.for fallback resolves
 * unambiguously.
 *
 * Persistence strategy (mirrors actionService):
 *   - On write: if owned by an entity with a model file, merge there; fallback
 *     is a dedicated `<name>.events.yaml`.
 *   - On read: scan packages via `loadPackage()`.
 *   - On delete: scan for the owning file and remove.
 */

import { Event } from '../models/Event.js';
import {
  readEventsForEntity,
  readEventsForPackage,
  writeEvent,
  deleteEvent as deleteEventFile,
  findEventOwner,
  loadPackage,
  listPackages,
} from '../utils/fileOperations.js';
import { generateUUID } from '../utils/uuid.js';
import { logger } from '../utils/logger.js';

// ── Validation ────────────────────────────────────────────────────────────────

export interface EventValidationError {
  field: string;
  message: string;
}

/** Validate an event's intrinsic structure (name-uniqueness is checked separately). */
export function validateEvent(event: Partial<Event>): EventValidationError[] {
  const errors: EventValidationError[] = [];

  if (!event.uuid) errors.push({ field: 'uuid', message: 'uuid is required' });
  if (!event.name) errors.push({ field: 'name', message: 'name is required' });

  // Validate payload attribute name uniqueness
  if (event.payload && event.payload.length > 0) {
    const names = event.payload.map(a => a.name);
    if (new Set(names).size !== names.length) {
      errors.push({ field: 'payload', message: 'Event payload attributes must have unique names' });
    }
    for (const a of event.payload) {
      if (!a.name) errors.push({ field: 'payload', message: 'Each payload attribute must have a name' });
    }
  }

  return errors;
}

/** Input for create — an Event plus an optional explicit target package. */
type CreateEventInput = Partial<Event> & { packageName?: string };

// ── Service class ─────────────────────────────────────────────────────────────

class EventService {
  /**
   * List events. Filter by `ownerRef` (entity UUID) or `packageName`; with no
   * filter, scan all packages.
   */
  async list(filters: { ownerRef?: string; packageName?: string } = {}): Promise<Event[]> {
    try {
      if (filters.ownerRef) return await readEventsForEntity(filters.ownerRef);
      if (filters.packageName) return await readEventsForPackage(filters.packageName);

      const packages = await listPackages();
      const result: Event[] = [];
      for (const pkg of packages) {
        const model = await loadPackage(pkg);
        result.push(...model.events);
      }
      return result;
    } catch (error) {
      logger.error(`Error listing events: ${error}`);
      return [];
    }
  }

  /** Get one event by UUID. */
  async getByUuid(uuid: string): Promise<Event | null> {
    try {
      const owner = await findEventOwner(uuid);
      if (!owner) return null;
      const model = await loadPackage(owner.packageName);
      return model.events.find(e => e.uuid === uuid) ?? null;
    } catch (error) {
      logger.error(`Error getting event ${uuid}: ${error}`);
      return null;
    }
  }

  /**
   * Create a new event. The target package is derived from `ownerRef` (the
   * owning entity's package) or an explicit `packageName`.
   */
  async create(data: CreateEventInput): Promise<Event | { errors: EventValidationError[] }> {
    const event: Event = {
      uuid: data.uuid || generateUUID(),
      name: data.name || '',
      description: data.description,
      ownerRef: data.ownerRef || undefined,
      payload: data.payload ?? undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const resolved = await this.resolveTargetPackage(event.ownerRef, data.packageName);
    if ('errors' in resolved) return resolved;
    const packageName = resolved.packageName;

    const errors = validateEvent(event);
    const model = await loadPackage(packageName);
    if (model.events.some(e => e.name === event.name && e.uuid !== event.uuid)) {
      errors.push({ field: 'name', message: `An event named '${event.name}' already exists in package '${packageName}'` });
    }
    if (errors.length > 0) return { errors };

    const result = await writeEvent(event, packageName);
    if (!result.ok) return { errors: [{ field: '_', message: 'Failed to persist event' }] };
    return event;
  }

  /** Update an existing event. */
  async update(uuid: string, data: Partial<Event>): Promise<Event | { errors: EventValidationError[] } | null> {
    const owner = await findEventOwner(uuid);
    if (!owner) return null;
    const existing = (await loadPackage(owner.packageName)).events.find(e => e.uuid === uuid);
    if (!existing) return null;

    const updated: Event = {
      ...existing,
      ...data,
      uuid,
      updatedAt: new Date().toISOString(),
    };

    const errors = validateEvent(updated);
    const model = await loadPackage(owner.packageName);
    if (model.events.some(e => e.name === updated.name && e.uuid !== uuid)) {
      errors.push({ field: 'name', message: `An event named '${updated.name}' already exists in package '${owner.packageName}'` });
    }
    if (errors.length > 0) return { errors };

    const result = await writeEvent(updated, owner.packageName);
    if (!result.ok) return { errors: [{ field: '_', message: 'Failed to persist event' }] };
    return updated;
  }

  /** Delete an event by UUID. */
  async delete(uuid: string): Promise<boolean> {
    const result = await deleteEventFile(uuid);
    return result.ok;
  }

  /** Resolve the package a new event should be written to. */
  private async resolveTargetPackage(
    ownerRef: string | undefined,
    explicitPackage: string | undefined,
  ): Promise<{ packageName: string } | { errors: EventValidationError[] }> {
    const packages = await listPackages();
    if (ownerRef) {
      for (const pkg of packages) {
        const model = await loadPackage(pkg);
        if (model.ownership.entityByUuid.has(ownerRef)) return { packageName: pkg };
      }
      return { errors: [{ field: 'ownerRef', message: `Entity '${ownerRef}' not found in any package` }] };
    }
    if (explicitPackage) {
      if (!packages.includes(explicitPackage)) {
        return { errors: [{ field: 'packageName', message: `Package '${explicitPackage}' not found` }] };
      }
      return { packageName: explicitPackage };
    }
    return { errors: [{ field: 'ownerRef', message: 'Either ownerRef (entity) or packageName is required' }] };
  }
}

export const eventService = new EventService();
