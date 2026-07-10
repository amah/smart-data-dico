/**
 * Shared attribute physical-mapping resolution for the AI read path
 * (#grounding). getSqlSchema (aiSql.ts) and getEntityDetails (aiController.ts)
 * must tell the model the SAME story about how an attribute maps to a column.
 *
 * Two authoring generations coexist on disk:
 *  - Reverse-engineered entities (services/reverseEngineer/synthesize.ts)
 *    write `physical.columnName` metadata and the `Attribute.primaryKey`
 *    schema field.
 *  - Older / hand-authored files (e.g. the eshop sample) carry the PK as
 *    attribute metadata `isPrimaryKey` instead, and no column mapping at all —
 *    the `orm.*` vocabulary (models/ormVocabulary.ts) has no column-name key,
 *    so for those files the logical attribute name IS the column convention.
 *
 * This helper normalizes both generations so PK flags survive and
 * physicalMappingMissing is only reported when no mapping info exists.
 */

export interface MetadataEntryLike { name: string; value: unknown }

/** Pull a metadata value off a MetadataEntry[] array, as a string. */
export function metaValue(
  meta: MetadataEntryLike[] | undefined,
  name: string,
): string | undefined {
  const e = meta?.find(m => m.name === name);
  return e && e.value != null ? String(e.value) : undefined;
}

/** Truthy flag metadata: true / 'true' / 'yes' / '1' (case-insensitive). */
function metaFlag(meta: MetadataEntryLike[] | undefined, name: string): boolean {
  const v = meta?.find(m => m.name === name)?.value;
  return v === true || /^(true|yes|1)$/i.test(String(v ?? ''));
}

export interface AttributePhysical {
  /** Explicitly authored physical column name, when present. */
  columnName?: string;
  /** Explicitly authored physical DB type, when present. */
  dbType?: string;
  /** Schema field first, `isPrimaryKey` attribute metadata as fallback. */
  primaryKey: boolean;
}

export function resolveAttributePhysical(a: {
  primaryKey?: boolean;
  metadata?: MetadataEntryLike[];
}): AttributePhysical {
  const columnName = metaValue(a.metadata, 'physical.columnName');
  const dbType = metaValue(a.metadata, 'physical.dbType');
  return {
    ...(columnName ? { columnName } : {}),
    ...(dbType ? { dbType } : {}),
    // == null: a YAML `primaryKey:` left empty means "unset", not false —
    // fall back to the legacy metadata flag in that case too.
    primaryKey: a.primaryKey == null
      ? metaFlag(a.metadata, 'isPrimaryKey')
      : !!a.primaryKey,
  };
}
