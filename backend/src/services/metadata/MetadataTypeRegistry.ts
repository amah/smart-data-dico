import type { MetadataDefinition, MetadataEntry, MetadataValue } from '../../models/EntitySchema.js';
import { logger } from '../../utils/logger.js';

// ─── Public interfaces ────────────────────────────────────────────────────────

export interface JsonSchemaFragment {
  type?: string | string[];
  enum?: unknown[];
  format?: string;
  properties?: Record<string, JsonSchemaFragment>;
  items?: JsonSchemaFragment;
  required?: string[];
  description?: string;
  [k: string]: unknown;
}

export interface MetadataValidationError {
  /** Dotted path from the root entry value. '' for a top-level error. */
  path: string;
  message: string;
}

export interface MetadataValidationResult {
  ok: boolean;
  errors: MetadataValidationError[];
}

/**
 * Backend-portable half of a metadata-type contribution. No React, no DOM.
 * Mirrored on the frontend which adds Editor + Viewer + searchFacets.
 */
export interface MetadataTypeContributionCore<T extends MetadataValue = MetadataValue> {
  /** Contribution key — matches `MetadataDefinition.type`. Globally unique. */
  type: string;
  /** Human label for pickers. */
  label: string;
  /** Value used when no entry is present and the field is rendered. */
  defaultValue: T;
  /** Stereotype targets this contribution may be attached to. Undefined = all. */
  appliesTo?: Array<'package' | 'entity' | 'attribute' | 'model' | 'relationship'>;
  /** Validate a stored value against a definition. Path-aware. */
  validate(value: unknown, def: MetadataDefinition): MetadataValidationResult;
  /** Normalize an in-memory value to its on-disk form. Identity for most types. */
  serialize(value: T): MetadataValue;
  /** Normalize a raw YAML value to the in-memory form. Identity for most types. */
  parse(raw: unknown): T;
  /** Translate a definition into a JSON Schema fragment for exportService. */
  toJsonSchema(def: MetadataDefinition): JsonSchemaFragment;
  /** Render an entry as Markdown — single line for scalars, indented for object/array. */
  toMarkdown(value: T, def?: MetadataDefinition): string;
}

export interface MetadataTypeRegistryBackend {
  register(c: MetadataTypeContributionCore): void;
  get(type: string): MetadataTypeContributionCore | undefined;
  list(): MetadataTypeContributionCore[];
  /**
   * Validate a single metadata entry against the registry. Resolves the
   * contribution from `def.type`, dispatches `validate`, and prefixes each
   * returned error's path with the entry name.
   */
  validateEntry(entry: MetadataEntry, def: MetadataDefinition): MetadataValidationError[];
  /**
   * Validate an entire stereotype-shaped metadata block. Returns all
   * required-entry-missing errors PLUS all per-entry validate() errors,
   * flattened with stable ordering.
   */
  validateBlock(
    metadata: MetadataEntry[] | undefined,
    defs: MetadataDefinition[],
    stereotypeName: string,
  ): MetadataValidationError[];
}

// ─── Implementation ───────────────────────────────────────────────────────────

class MetadataTypeRegistryImpl implements MetadataTypeRegistryBackend {
  private readonly _map = new Map<string, MetadataTypeContributionCore>();

  register(c: MetadataTypeContributionCore): void {
    if (this._map.has(c.type)) {
      // Last-write-wins; log a debug warning so test tooling can detect
      // accidental double-registration.
      logger.debug(`[MetadataTypeRegistry] Re-registering contribution '${c.type}' (last-write-wins)`);
    }
    this._map.set(c.type, c);
  }

  get(type: string): MetadataTypeContributionCore | undefined {
    return this._map.get(type);
  }

  list(): MetadataTypeContributionCore[] {
    return Array.from(this._map.values());
  }

  validateEntry(entry: MetadataEntry, def: MetadataDefinition): MetadataValidationError[] {
    const contribution = this._map.get(def.type);
    if (!contribution) {
      // Unknown type — no validation errors (pass through)
      return [];
    }
    const result = contribution.validate(entry.value, def);
    if (result.ok) return [];
    // Prefix each error path with the entry name
    return result.errors.map((e) => ({
      path: e.path ? `${entry.name}.${e.path}` : entry.name,
      message: e.message,
    }));
  }

  validateBlock(
    metadata: MetadataEntry[] | undefined,
    defs: MetadataDefinition[],
    stereotypeName: string,
  ): MetadataValidationError[] {
    const errors: MetadataValidationError[] = [];
    const entries = metadata || [];

    for (const def of defs) {
      const entry = entries.find((m) => m.name === def.name);
      if (def.required) {
        if (!entry || entry.value === undefined || entry.value === '' || entry.value === null) {
          errors.push({
            path: def.name,
            message: `Required metadata '${def.name}' is missing (stereotype: ${stereotypeName})`,
          });
          continue;
        }
      }
      if (entry) {
        const entryErrors = this.validateEntry(entry, def);
        errors.push(...entryErrors);
      }
    }

    return errors;
  }
}

/**
 * Create a new, empty registry instance. Used in tests and for the
 * module-singleton below.
 */
export function createMetadataTypeRegistry(): MetadataTypeRegistryBackend {
  return new MetadataTypeRegistryImpl();
}

/**
 * Module-singleton registry used by stereotypeService + exportService.
 * Seeded with built-in contributions by importing builtinContributions.ts.
 */
export const metadataTypeRegistry: MetadataTypeRegistryBackend = createMetadataTypeRegistry();
