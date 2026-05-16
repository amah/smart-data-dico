import type { MetadataValue } from '../../models/EntitySchema.js';

/**
 * Recursively flattens a MetadataValue into a search-friendly string.
 * Scalar values stringify directly; arrays join their flattened parts with
 * ' '; objects emit `key value key value` pairs flattened recursively.
 *
 *   metadataValueToSearchString('foo')                          === 'foo'
 *   metadataValueToSearchString(42)                             === '42'
 *   metadataValueToSearchString(['a', 'b'])                     === 'a b'
 *   metadataValueToSearchString({ level: 'pii', count: 3 })     === 'level pii count 3'
 *   metadataValueToSearchString({ a: [1, 2] })                  === 'a 1 2'
 */
export function metadataValueToSearchString(value: MetadataValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => metadataValueToSearchString(v)).join(' ');
  }
  // Object
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    parts.push(k);
    parts.push(metadataValueToSearchString(v));
  }
  return parts.join(' ');
}
