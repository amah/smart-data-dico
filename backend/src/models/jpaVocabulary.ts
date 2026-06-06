/**
 * Canonical vocabulary for the reserved `jpa.*` metadata namespace (the keys
 * that let the dico bear a full JPA mapping; see docs/format-reference.md §14).
 *
 * SINGLE SOURCE OF TRUTH: the validator (validateDico.ts) derives its allowed
 * keys/values from here, and the frontend fetches it via GET /api/jpa/vocabulary
 * to render typed editors — so the two never drift. Adding a key here makes it
 * known to both the validator and the editor.
 *
 * Purely a metadata convention (like `physical.*`): no core-schema change.
 */

export const JPA_PREFIX = 'jpa.' as const;

export type JpaScope = 'entity' | 'attribute' | 'relationship';

/** How a key's value is typed/edited and validated. */
export type JpaKind =
  | 'string'      // free text
  | 'int'         // integer
  | 'flag'        // boolean
  | 'enum'        // one of `values`
  | 'enumList'    // comma-separated / list, each token in `values`
  | 'entityRef';  // an entity uuid or name

export interface JpaKeyDef {
  key: string;
  kind: JpaKind;
  /** Allowed values for kind 'enum' / 'enumList'. */
  values?: readonly string[];
  /** Short human label for the editor. */
  label: string;
  /** What this maps to in JPA, for tooltips/preview. */
  mapsTo: string;
}

export const JPA_VOCABULARY: Record<JpaScope, readonly JpaKeyDef[]> = {
  entity: [
    { key: 'jpa.package', kind: 'string', label: 'Java package', mapsTo: 'class package (FQN)' },
    { key: 'jpa.className', kind: 'string', label: 'Class name', mapsTo: 'class name override' },
    { key: 'jpa.embeddable', kind: 'flag', label: 'Embeddable', mapsTo: '@Embeddable' },
    { key: 'jpa.mappedSuperclass', kind: 'flag', label: 'Mapped superclass', mapsTo: '@MappedSuperclass' },
    { key: 'jpa.extends', kind: 'entityRef', label: 'Extends (supertype)', mapsTo: 'inheritance — extends parent entity' },
    { key: 'jpa.inheritanceStrategy', kind: 'enum', values: ['SINGLE_TABLE', 'JOINED', 'TABLE_PER_CLASS'], label: 'Inheritance strategy', mapsTo: '@Inheritance (on root)' },
    { key: 'jpa.discriminatorColumn', kind: 'string', label: 'Discriminator column', mapsTo: '@DiscriminatorColumn (root)' },
    { key: 'jpa.discriminatorValue', kind: 'string', label: 'Discriminator value', mapsTo: '@DiscriminatorValue (subclass)' },
    { key: 'jpa.idClass', kind: 'string', label: 'Id class', mapsTo: '@IdClass (composite key)' },
    { key: 'jpa.embeddedId', kind: 'string', label: 'Embedded id', mapsTo: '@EmbeddedId (composite key)' },
  ],
  attribute: [
    { key: 'jpa.javaType', kind: 'string', label: 'Java type', mapsTo: 'field Java type override' },
    { key: 'jpa.generatedValue', kind: 'enum', values: ['IDENTITY', 'SEQUENCE', 'TABLE', 'UUID', 'AUTO', 'NONE'], label: 'Generated value', mapsTo: '@GeneratedValue' },
    { key: 'jpa.sequenceName', kind: 'string', label: 'Sequence name', mapsTo: '@SequenceGenerator(name)' },
    { key: 'jpa.allocationSize', kind: 'int', label: 'Allocation size', mapsTo: '@SequenceGenerator(allocationSize)' },
    { key: 'jpa.enumerated', kind: 'enum', values: ['STRING', 'ORDINAL'], label: 'Enumerated', mapsTo: '@Enumerated (enum attrs)' },
    { key: 'jpa.enumType', kind: 'string', label: 'Enum type', mapsTo: 'generated Java enum class' },
    { key: 'jpa.version', kind: 'flag', label: 'Version', mapsTo: '@Version' },
    { key: 'jpa.transient', kind: 'flag', label: 'Transient', mapsTo: '@Transient' },
    { key: 'jpa.lob', kind: 'flag', label: 'Lob', mapsTo: '@Lob' },
    { key: 'jpa.temporal', kind: 'enum', values: ['DATE', 'TIME', 'TIMESTAMP'], label: 'Temporal', mapsTo: '@Temporal' },
    { key: 'jpa.converter', kind: 'string', label: 'Converter', mapsTo: '@Convert(converter)' },
    { key: 'jpa.elementCollection', kind: 'flag', label: 'Element collection', mapsTo: '@ElementCollection' },
    { key: 'jpa.embedded', kind: 'flag', label: 'Embedded', mapsTo: '@Embedded' },
  ],
  relationship: [
    { key: 'jpa.fetch', kind: 'enum', values: ['LAZY', 'EAGER'], label: 'Fetch', mapsTo: 'fetch type' },
    { key: 'jpa.cascade', kind: 'enumList', values: ['ALL', 'PERSIST', 'MERGE', 'REMOVE', 'REFRESH', 'DETACH'], label: 'Cascade', mapsTo: 'cascade types' },
    { key: 'jpa.orphanRemoval', kind: 'flag', label: 'Orphan removal', mapsTo: 'orphanRemoval' },
    { key: 'jpa.optional', kind: 'flag', label: 'Optional', mapsTo: 'optional' },
    { key: 'jpa.mappedBy', kind: 'string', label: 'Mapped by', mapsTo: 'mappedBy (inverse side)' },
    { key: 'jpa.owningEnd', kind: 'string', label: 'Owning end', mapsTo: 'owning side role' },
    { key: 'jpa.joinTable', kind: 'string', label: 'Join table', mapsTo: '@JoinTable(name) for many-to-many' },
    { key: 'jpa.joinColumns', kind: 'string', label: 'Join columns', mapsTo: '@JoinTable joinColumns' },
    { key: 'jpa.inverseJoinColumns', kind: 'string', label: 'Inverse join columns', mapsTo: '@JoinTable inverseJoinColumns' },
  ],
};

// ── Derived lookups (consumed by the validator; one source of truth) ─────────

/** Allowed key set per scope. */
export const JPA_KEYS: Record<JpaScope, Set<string>> = {
  entity: new Set(JPA_VOCABULARY.entity.map(d => d.key)),
  attribute: new Set(JPA_VOCABULARY.attribute.map(d => d.key)),
  relationship: new Set(JPA_VOCABULARY.relationship.map(d => d.key)),
};

const allDefs: JpaKeyDef[] = [
  ...JPA_VOCABULARY.entity, ...JPA_VOCABULARY.attribute, ...JPA_VOCABULARY.relationship,
];

/** Single-value enum keys → their allowed values. */
export const JPA_ENUM_VALUES: Record<string, readonly string[]> = Object.fromEntries(
  allDefs.filter(d => d.kind === 'enum' && d.values).map(d => [d.key, d.values as readonly string[]]),
);

/** Allowed cascade tokens (the one `enumList` key). */
export const JPA_CASCADE_VALUES: readonly string[] =
  allDefs.find(d => d.key === 'jpa.cascade')?.values ?? [];

/** Boolean-flag keys. */
export const JPA_FLAG_KEYS: Set<string> = new Set(
  allDefs.filter(d => d.kind === 'flag').map(d => d.key),
);
