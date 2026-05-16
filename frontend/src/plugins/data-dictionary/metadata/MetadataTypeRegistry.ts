import type { ComponentType } from 'react';
import type {
  MetadataValue,
  MetadataDefinition,
  MetadataTypeContributionCore,
} from '../../../types';

// ─── Editor / Viewer prop shapes ─────────────────────────────────────────────

export interface MetadataEditorInputProps<T> {
  value: T;
  onChange: (next: T) => void;
  def: MetadataDefinition;
  /** Dotted path from the root entry value — used to compose nested error keys. */
  path: string;
  readOnly?: boolean;
}

export interface MetadataViewerProps<T> {
  value: T;
  def: MetadataDefinition;
}

// ─── Full frontend contribution ───────────────────────────────────────────────

export interface MetadataTypeContribution<T extends MetadataValue = MetadataValue>
  extends MetadataTypeContributionCore<T> {
  Editor: ComponentType<MetadataEditorInputProps<T>>;
  Viewer: ComponentType<MetadataViewerProps<T>>;
  /** Optional facets the search plugin can index this value under. */
  searchFacets?: Array<{ path: string; kind: 'enum' | 'string' | 'number' | 'boolean' | 'date' }>;
}

// ─── Registry interface ───────────────────────────────────────────────────────

export interface MetadataTypeRegistry {
  register(c: MetadataTypeContribution): void;
  get(type: string): MetadataTypeContribution | undefined;
  list(): MetadataTypeContribution[];
  /** Frontend convenience — returns contribution for the type, or the unknown fallback. */
  getOrFallback(type: string): MetadataTypeContribution;
  /** Set or replace the fallback used by getOrFallback. */
  setFallback(c: MetadataTypeContribution): void;
}

// ─── Implementation ───────────────────────────────────────────────────────────

class MetadataTypeRegistryImpl implements MetadataTypeRegistry {
  private readonly _map = new Map<string, MetadataTypeContribution>();
  private _fallback: MetadataTypeContribution | undefined;

  setFallback(c: MetadataTypeContribution): void {
    this._fallback = c;
  }

  register(c: MetadataTypeContribution): void {
    if (this._map.has(c.type)) {
      if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
        console.debug(`[MetadataTypeRegistry] Re-registering contribution '${c.type}' (last-write-wins)`);
      }
    }
    this._map.set(c.type, c);
  }

  get(type: string): MetadataTypeContribution | undefined {
    return this._map.get(type);
  }

  list(): MetadataTypeContribution[] {
    return Array.from(this._map.values());
  }

  getOrFallback(type: string): MetadataTypeContribution {
    const found = this._map.get(type);
    if (found) return found;
    if (this._fallback) return this._fallback;
    // Should not reach here after initialize() sets the fallback.
    // Return a very minimal no-op contribution as a last resort.
    return {
      type,
      label: `Unknown (${type})`,
      defaultValue: '' as MetadataValue,
      validate: () => ({ ok: true, errors: [] }),
      serialize: (v: MetadataValue) => v,
      parse: (raw: unknown) => (raw as MetadataValue) ?? '',
      toJsonSchema: () => ({}),
      toMarkdown: (v: MetadataValue) => String(v),
      // Placeholder components — replaced by the real fallback when initialize() runs.
      Editor: (() => null) as any,
      Viewer: (() => null) as any,
    };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createMetadataTypeRegistry(opts?: {
  unknownTypeFallback?: MetadataTypeContribution;
}): MetadataTypeRegistry {
  const registry = new MetadataTypeRegistryImpl();
  if (opts?.unknownTypeFallback) {
    registry.setFallback(opts.unknownTypeFallback);
  }
  return registry;
}
