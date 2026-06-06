/**
 * Canonical vocabulary for the reserved `orm.*` metadata namespace (the keys
 * that let the dico bear a full ORM mapping; see docs/format-reference.md §14).
 *
 * SINGLE SOURCE OF TRUTH: the validator (validateDico.ts) derives its allowed
 * keys/values from here, and the frontend fetches it via GET /api/orm/vocabulary
 * to render typed editors — so the two never drift. Adding a key here makes it
 * known to both the validator and the editor.
 *
 * Purely a metadata convention (like `physical.*`): no core-schema change.
 */

export const ORM_PREFIX = 'orm.' as const;

export type OrmScope = 'entity' | 'attribute' | 'relationship';

/** How a key's value is typed/edited and validated. */
export type OrmKind =
  | 'string'      // free text
  | 'int'         // integer
  | 'flag'        // boolean
  | 'enum'        // one of `values`
  | 'enumList'    // comma-separated / list, each token in `values`
  | 'entityRef';  // an entity uuid or name

export interface OrmKeyDef {
  key: string;
  kind: OrmKind;
  /** Allowed values for kind 'enum' / 'enumList'. */
  values?: readonly string[];
  /** Short human label for the editor. */
  label: string;
  /** What this maps to in ORM, for tooltips/preview. */
  mapsTo: string;
}

export const ORM_VOCABULARY: Record<OrmScope, readonly OrmKeyDef[]> = {
  entity: [
    { key: 'orm.package', kind: 'string', label: 'Java package', mapsTo: 'class package (FQN)' },
    { key: 'orm.className', kind: 'string', label: 'Class name', mapsTo: 'class name override' },
    { key: 'orm.embeddable', kind: 'flag', label: 'Embeddable', mapsTo: '@Embeddable' },
    { key: 'orm.mappedSuperclass', kind: 'flag', label: 'Mapped superclass', mapsTo: '@MappedSuperclass' },
    { key: 'orm.extends', kind: 'entityRef', label: 'Extends (supertype)', mapsTo: 'inheritance — extends parent entity' },
    { key: 'orm.inheritanceStrategy', kind: 'enum', values: ['SINGLE_TABLE', 'JOINED', 'TABLE_PER_CLASS'], label: 'Inheritance strategy', mapsTo: '@Inheritance (on root)' },
    { key: 'orm.discriminatorColumn', kind: 'string', label: 'Discriminator column', mapsTo: '@DiscriminatorColumn (root)' },
    { key: 'orm.discriminatorValue', kind: 'string', label: 'Discriminator value', mapsTo: '@DiscriminatorValue (subclass)' },
    { key: 'orm.idClass', kind: 'string', label: 'Id class', mapsTo: '@IdClass (composite key)' },
    { key: 'orm.embeddedId', kind: 'string', label: 'Embedded id', mapsTo: '@EmbeddedId (composite key)' },
  ],
  attribute: [
    { key: 'orm.javaType', kind: 'string', label: 'Java type', mapsTo: 'field Java type override' },
    { key: 'orm.generatedValue', kind: 'enum', values: ['IDENTITY', 'SEQUENCE', 'TABLE', 'UUID', 'AUTO', 'NONE'], label: 'Generated value', mapsTo: '@GeneratedValue' },
    { key: 'orm.sequenceName', kind: 'string', label: 'Sequence name', mapsTo: '@SequenceGenerator(name)' },
    { key: 'orm.allocationSize', kind: 'int', label: 'Allocation size', mapsTo: '@SequenceGenerator(allocationSize)' },
    { key: 'orm.enumerated', kind: 'enum', values: ['STRING', 'ORDINAL'], label: 'Enumerated', mapsTo: '@Enumerated (enum attrs)' },
    { key: 'orm.enumType', kind: 'string', label: 'Enum type', mapsTo: 'generated Java enum class' },
    { key: 'orm.version', kind: 'flag', label: 'Version', mapsTo: '@Version' },
    { key: 'orm.transient', kind: 'flag', label: 'Transient', mapsTo: '@Transient' },
    { key: 'orm.lob', kind: 'flag', label: 'Lob', mapsTo: '@Lob' },
    { key: 'orm.temporal', kind: 'enum', values: ['DATE', 'TIME', 'TIMESTAMP'], label: 'Temporal', mapsTo: '@Temporal' },
    { key: 'orm.converter', kind: 'string', label: 'Converter', mapsTo: '@Convert(converter)' },
    { key: 'orm.elementCollection', kind: 'flag', label: 'Element collection', mapsTo: '@ElementCollection' },
    { key: 'orm.embedded', kind: 'flag', label: 'Embedded', mapsTo: '@Embedded' },
  ],
  relationship: [
    { key: 'orm.fetch', kind: 'enum', values: ['LAZY', 'EAGER'], label: 'Fetch', mapsTo: 'fetch type' },
    { key: 'orm.cascade', kind: 'enumList', values: ['ALL', 'PERSIST', 'MERGE', 'REMOVE', 'REFRESH', 'DETACH'], label: 'Cascade', mapsTo: 'cascade types' },
    { key: 'orm.orphanRemoval', kind: 'flag', label: 'Orphan removal', mapsTo: 'orphanRemoval' },
    { key: 'orm.optional', kind: 'flag', label: 'Optional', mapsTo: 'optional' },
    { key: 'orm.mappedBy', kind: 'string', label: 'Mapped by', mapsTo: 'mappedBy (inverse side)' },
    { key: 'orm.owningEnd', kind: 'string', label: 'Owning end', mapsTo: 'owning side role' },
    { key: 'orm.joinTable', kind: 'string', label: 'Join table', mapsTo: '@JoinTable(name) for many-to-many' },
    { key: 'orm.joinColumns', kind: 'string', label: 'Join columns', mapsTo: '@JoinTable joinColumns' },
    { key: 'orm.inverseJoinColumns', kind: 'string', label: 'Inverse join columns', mapsTo: '@JoinTable inverseJoinColumns' },
  ],
};

// ── Derived lookups (consumed by the validator; one source of truth) ─────────

/** Allowed key set per scope. */
export const ORM_KEYS: Record<OrmScope, Set<string>> = {
  entity: new Set(ORM_VOCABULARY.entity.map(d => d.key)),
  attribute: new Set(ORM_VOCABULARY.attribute.map(d => d.key)),
  relationship: new Set(ORM_VOCABULARY.relationship.map(d => d.key)),
};

const allDefs: OrmKeyDef[] = [
  ...ORM_VOCABULARY.entity, ...ORM_VOCABULARY.attribute, ...ORM_VOCABULARY.relationship,
];

/** Single-value enum keys → their allowed values. */
export const ORM_ENUM_VALUES: Record<string, readonly string[]> = Object.fromEntries(
  allDefs.filter(d => d.kind === 'enum' && d.values).map(d => [d.key, d.values as readonly string[]]),
);

/** Allowed cascade tokens (the one `enumList` key). */
export const ORM_CASCADE_VALUES: readonly string[] =
  allDefs.find(d => d.key === 'orm.cascade')?.values ?? [];

/** Boolean-flag keys. */
export const ORM_FLAG_KEYS: Set<string> = new Set(
  allDefs.filter(d => d.kind === 'flag').map(d => d.key),
);
