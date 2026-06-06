/**
 * Metadata readers for the diagram element builders (#184/#186).
 *
 * ORM and physical mappings live as dot-keyed entries in `metadata[]`
 * (`orm.className`, `physical.tableName`, …) on entities, attributes and
 * relationships. These tiny readers normalise the loose `MetadataValue` union
 * into the scalar shapes the builders want, mirroring the backend's `readMeta`
 * in impactDiff.ts so the two stay aligned.
 */
import type { MetadataEntry, MetadataValue } from '../../types';

export function readMeta(
  metadata: MetadataEntry[] | undefined,
  key: string,
): MetadataValue | undefined {
  return (metadata || []).find((m) => m.name === key)?.value;
}

/** Scalar string value, or undefined when unset / non-scalar / empty. */
export function readMetaString(
  metadata: MetadataEntry[] | undefined,
  key: string,
): string | undefined {
  const v = readMeta(metadata, key);
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/** Boolean flag — true only for `true` / `"true"`. */
export function readMetaFlag(metadata: MetadataEntry[] | undefined, key: string): boolean {
  const v = readMeta(metadata, key);
  return v === true || v === 'true';
}

/**
 * List value (the one `enumList` key, `orm.cascade`). Accepts a real array or a
 * comma-separated string; returns trimmed, non-empty tokens.
 */
export function readMetaList(metadata: MetadataEntry[] | undefined, key: string): string[] {
  const v = readMeta(metadata, key);
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
