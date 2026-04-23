import { useState, useEffect, useMemo } from 'react';
import { stereotypeApi } from '../services/api';
import type { Stereotype, MetadataDefinition, StereotypeTarget, Attribute, MetadataEntry } from '../types';

export interface MetadataColumn {
  /** Metadata definition name (key in the metadata array) */
  name: string;
  /** Human-readable label */
  label: string;
  /** Value type: string, number, flag, boolean, date, rule */
  type: string;
  /** Whether required by the stereotype */
  required: boolean;
  /** Description tooltip */
  description?: string;
  /** Source stereotype id */
  stereotypeId: string;
  /** Source stereotype name */
  stereotypeName: string;
}

/**
 * Fetches all stereotypes and derives metadata column definitions.
 * Can be filtered by appliesTo target (entity, attribute, relationship).
 */
export function useStereotypeMetadata(appliesTo?: StereotypeTarget) {
  const [stereotypes, setStereotypes] = useState<Stereotype[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    stereotypeApi
      .getAll(appliesTo)
      .then(setStereotypes)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [appliesTo]);

  /** All possible metadata columns, grouped by stereotype */
  const allColumns = useMemo<MetadataColumn[]>(() => {
    const cols: MetadataColumn[] = [];
    for (const st of stereotypes) {
      for (const md of st.metadataDefinitions || []) {
        cols.push({
          name: md.name,
          label: md.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          type: md.type,
          required: !!md.required,
          description: md.description,
          stereotypeId: st.id,
          stereotypeName: st.name,
        });
      }
    }
    return cols;
  }, [stereotypes]);

  /** Map from stereotype id to its columns */
  const columnsByStereotype = useMemo(() => {
    const map: Record<string, MetadataColumn[]> = {};
    for (const col of allColumns) {
      if (!map[col.stereotypeId]) map[col.stereotypeId] = [];
      map[col.stereotypeId].push(col);
    }
    return map;
  }, [allColumns]);

  return { stereotypes, allColumns, columnsByStereotype, loading };
}

/**
 * Get the metadata columns relevant to a set of attributes
 * (based on which stereotypes are actually used).
 */
export function getActiveColumns(
  attributes: Attribute[],
  allColumns: MetadataColumn[],
): MetadataColumn[] {
  // Collect all metadata keys actually present across attributes
  const usedKeys = new Set<string>();
  for (const attr of attributes) {
    for (const entry of attr.metadata || []) {
      usedKeys.add(entry.name);
    }
  }
  // Return columns that match used keys
  return allColumns.filter(col => usedKeys.has(col.name));
}

/**
 * Helper: get a metadata value from any element that carries a metadata
 * array (attribute, entity, relationship).
 */
export function getMetadataValue(
  target: { metadata?: MetadataEntry[] },
  metadataName: string,
): string | number | boolean | undefined {
  const entry = (target.metadata || []).find(m => m.name === metadataName);
  return entry?.value;
}

/**
 * Helper: set a metadata value, returning a new metadata array.
 */
export function setMetadataValue(
  currentMetadata: MetadataEntry[] | undefined,
  name: string,
  value: string | number | boolean,
): MetadataEntry[] {
  const entries = [...(currentMetadata || [])];
  const idx = entries.findIndex(m => m.name === name);
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], value };
  } else {
    entries.push({ name, value });
  }
  return entries;
}
