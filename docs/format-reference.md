# Data Dictionary Format Reference

This is the authoritative, human-readable reference for the on-disk format of a Smart Data Dictionary project. It consolidates what was previously spread across `CLAUDE.md`, `docs/deployment.md`, the TypeScript models, and the `samples/eshop/` fixture.

A project is **file-based**: a folder tree of YAML and JSON, version-controlled with git. There is no database. The format is defined by the TypeScript models under `backend/src/models/` — this document explains them; those files (and their JSON Schema validators) are the source of truth if the two ever disagree.

> **Source of truth.** Core shapes live in `backend/src/models/EntitySchema.ts` (entities, attributes, relationships, stereotypes, cases, physical constraints), `Rule.ts`, `Action.ts`, `StateMachine.ts`, and `Dictionary.ts`. `EntitySchema.ts` also exports runnable JSON Schema validators (`validateEntity`, `validateRelationship`).

---

## 1. Project layout

A **project** is any folder containing `dico.config.json`. **Packages** are the top-level folders inside it, each marked by a `package.yaml`. System files live under `.dico/`.

```
my-project/                          # Project root (named anything)
├── dico.config.json                 # Project marker + derived-types registry (#107)
├── rules.yaml                       # (optional) global, cross-package rules
├── .dico/                           # Project-level system files
│   ├── stereotypes.yaml             # Legacy metadata-schema store (often `[]` — see §8)
│   ├── metadata.yaml                # (optional) model-level metadata (#94)
│   ├── schemas/                     # Schema-entities = stereotype defs (#165)
│   │   └── <slug>.entity.yaml
│   └── diagrams/                    # Saved diagram layouts
│       └── <id>.json
├── order-service/                   # One folder per package
│   ├── package.yaml                 # Package marker (`name: order-service`)
│   ├── Order.model.yaml             # `entities:` (+ optional other sections)
│   ├── relationships.model.yaml     # `relationships:`
│   ├── rules.model.yaml             # `rules:`
│   ├── Ordering.case.yaml           # `cases:`
│   ├── Order.actions.yaml           # `actions:`
│   └── Order.statemachine.yaml      # `stateMachines:`
└── user-service/
    └── …
```

### Multi-kind YAML (#106)

The loader is **content-driven, not filename-driven**. Any `.yaml` file inside a package folder may carry any subset of these top-level sections:

`entities:` · `relationships:` · `rules:` · `cases:` · `perspectives:` · `actions:` · `stateMachines:`

The loader scans every file in the package, merges the sections, and raises a **hard error citing both paths** on any identifier collision (duplicate entity name, or duplicate rule / case / relationship / action / state-machine UUID).

Filenames are a **human convention only**:

| Convention | Holds |
|---|---|
| `<Name>.model.yaml` | one entity (plus any mixed content) |
| `relationships.model.yaml` | the package's `relationships:` |
| `rules.model.yaml` | package-scoped `rules:` |
| `<Name>.case.yaml` | one case |
| `<Name>.actions.yaml` | actions for one owner |
| `<Name>.statemachine.yaml` | state machines for one owner |
| `package.yaml` | **reserved** — the package marker |

---

## 2. `dico.config.json` — project marker & derived types

Marks the folder as a project and declares reusable **derived types** (#107).

```json
{
  "version": 1,
  "types": [
    {
      "name": "email",
      "basedOn": "string",
      "description": "RFC-5322 email",
      "validation": { "pattern": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", "maxLength": 254 }
    },
    {
      "name": "work-email",
      "basedOn": "email",
      "description": "Work-only email",
      "validation": { "maxLength": 200 }
    },
    { "name": "money", "basedOn": "number", "validation": { "precision": 12, "scale": 2 } }
  ]
}
```

- `basedOn` is a standard `AttributeType` **or another derived type** (transitive). Validation merges base → derived; derived fields win.
- An attribute may then declare `type: email` instead of `string`.
- Circular derivation is a hard error at `PUT /api/config/types`.
- JSON Schema export emits each derived type as a named `$defs` entry.

### 2.1 Value domains — `enum` / `codelist` / `reference`

A derived type may carry an optional `domain` that classifies *where its allowed
values come from*. This distinguishes three kinds — only `enum` is sourceless;
`codelist` and `reference` **must** name a `source`:

```json
{ "name": "order-status", "basedOn": "string",
  "domain": { "kind": "enum", "values": ["PENDING", "SHIPPED", "DELIVERED"] } },

{ "name": "currency-code", "basedOn": "string",
  "domain": { "kind": "codelist", "source": "ISO-4217", "values": ["USD", "EUR"] } },

{ "name": "country-ref", "basedOn": "string",
  "domain": { "kind": "reference", "source": "ISO-3166" } }
```

| kind | meaning | `values` | `source` |
|---|---|---|---|
| `enum` | inline closed set, ad-hoc to the type | **required** | forbidden |
| `codelist` | **static** managed reference set | optional (the static codes) | **required** |
| `reference` | **referential** — values drawn from a named data source | forbidden | **required** |

- Domains are **orthogonal to `validation`**; only the most-derived type's domain
  applies (resolved along the `basedOn` chain).
- JSON Schema export emits `enum`/`codelist` values as a standard `enum`, and keeps
  the kind/source as `x-domain` / `x-source` annotations.
- In the app: the `/types` editor has a **Value domain** section; the flat
  attributes view (`/entities/flat`) shows the kind in the **Type** column and a
  clickable **Source** column that deep-links to the type definition
  (`/types?name=<source>`).

### 2.2 Hide rules, Element Styles & style rules

`dico.config.json` may also carry three optional arrays that drive *views*, not
the data itself:

```json
{
  "hideRules": [
    { "match": "physicalTableName", "pattern": "*_bak", "reason": "backup" },
    { "match": "entityName", "pattern": "tmp_*" }
  ],
  "elementStyles": [
    { "name": "aggregate-root", "label": "Aggregate Root", "border": "primary", "borderWidth": 4, "emphasis": true, "badge": "AR" },
    { "name": "junction", "shape": "hexagon", "fill": "neutral-subtle", "opacity": 0.7 }
  ],
  "styleRules": [
    { "match": "stereotype", "pattern": "aggregate-root", "style": "aggregate-root" }
  ]
}
```

- **`hideRules[]`** (#hide-model-data) — declaratively **hide** matching elements
  (chiefly reverse-engineering waste: backup/temp/staging tables). `match` is
  `physicalTableName` | `entityName` | `packageName`; `pattern` is a glob (or a
  regex when `regex: true`). Hidden elements stay on disk but drop out of lists,
  diagrams, search and exports. Manage via `GET/PUT /api/config/hide-rules` or the
  UI's Hide/Unhide + "Show hidden". See `hide-model-data.md`.
- **`elementStyles[]`** + **`styleRules[]`** (#element-style) — named visual styles
  for diagram elements and the rules that bind them by role. A style's colors are
  **theme tokens** (`primary`, `neutral`, `warning`, `success`, `info`, `accent`,
  `base`, or a `*-subtle` variant) or hex. A rule's `match` is `stereotype` | `role`
  (`junction`|`reference`|`remote-ref`) | `entityName` | `physicalTableName`, and its
  `style` must name a defined `elementStyles[]` entry. Effective style precedence:
  explicit `system.style` override → first matching `styleRule` → detected role →
  stereotype → the `default`-flagged style (fallback for anything unstyled). Manage
  via `GET/PUT /api/config/element-styles|style-rules`, the `/element-styles` page,
  or the agent tools `defineElementStyle`/`addStyleRule`.
  See `element-style.md`.

---

## 3. Entities

An entity lives in any `.yaml` under its package as an `entities:` list item. Convention: one entity per `<Name>.model.yaml`.

```yaml
entities:
  - uuid: 96a3ac78-d30b-4bf5-bb61-bf3174212f6c   # required, UUID v1–v5
    name: Order                                   # required
    description: A customer purchase
    stereotype: aggregate-root                    # optional; name/id of a stereotype (§8)
    status: approved                              # draft | submitted | approved | returned
    attributes:                                   # required (may be empty)
      - uuid: d1a14e8a-745d-4997-8b7a-dc4fa49025d9
        name: orderNumber
        description: Human-readable order number
        type: string                              # AttributeType or a derived-type name
        required: true
        unique: true
        examples: [ORD-20250522-A1B2]
        validation:                               # §4
          pattern: ^ORD-[0-9]{8}-[A-Z0-9]{4}$
      - uuid: 74dda811-a63f-4067-9c50-f441318bd2f4
        name: totalAmount
        description: Total order amount
        type: number
        required: true
        validation: { minimum: 0, precision: 10, scale: 2 }
    constraints:                                  # §5 — physical, DB-enforced
      - kind: unique
        name: uq_orders_order_number
        columns: [order_number]
    metadata:                                     # §7 — typed metadata entries
      - { name: owner, value: payments-team }
    reviewComments: []                            # inlined since #106
    rules: []                                     # entity-scoped rules, inlined since #106
```

**`AttributeType`** (`EntitySchema.ts`): `string`, `number`, `integer`, `boolean`, `datetime`, `date`, `time`, `date-time`, `timestamp`, `duration`, `enum`, `object`, `array`, `uuid`. Or any derived-type name from `dico.config.json`.

**Nested shapes:**
- `type: object` → `properties:` (a keyed map of nested `Attribute`s).
- `type: array` → `items:` (a single nested `Attribute` describing the element).
- `type: enum` → allowed values go in `validation.enumValues`.

Each attribute carries its own `uuid`, so renames never break references.

> **Legacy fields.** The eshop sample's `Order.model.yaml` still carries pre-migration fields (`id`, `microservice`, `version`, and an inline `relationships:` block on the entity using a `name`/`type`/`target`/`inverseName` shape). These are tolerated on read but are **not** part of the canonical `Entity` model — new entities should use `uuid` and define relationships at package level (§6).

---

## 4. Validation — `attribute.validation`

Intrinsic shape rules, owned by the data steward, nested alongside `type` and `required`. Fields (`AttributeValidation`):

`minLength` · `maxLength` · `pattern` · `format` · `minimum` · `maximum` · `precision` · `scale` · `enumValues[]`

This is one of **three separate governance concepts** (#85) — do not collapse them:

| Concept | Lives as | Owner |
|---|---|---|
| **Validation** | `attribute.validation` | Data steward |
| **Constraint** | `entity.constraints[]` (§5) | DBA / persistence |
| **Rule** | first-class `Rule` (§9) | Business / domain expert |

---

## 5. Physical constraints — `entity.constraints[]`

DB-enforced constraints captured from SQL DDL or live introspection (`PhysicalConstraint`). Field set varies by `kind`:

```yaml
constraints:
  - kind: unique                       # columns required
    name: uq_orders_order_number
    columns: [order_number]
  - kind: check                        # expression required
    name: chk_orders_total_positive
    expression: total_amount >= 0
  - kind: foreignKey                   # columns + references required
    name: fk_orders_user
    columns: [user_id]
    references:
      table: users
      columns: [id]
      onDelete: CASCADE                # CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION
      onUpdate: RESTRICT
  - kind: index                        # columns required; perf hint only
    columns: [created_at]
```

---

## 6. Relationships

Package-level, in a `relationships:` section (conventionally `relationships.model.yaml`). Source/target are **entity UUIDs**.

Two shapes coexist (`Relationship`):

- **Preferred (#99): symmetric `ends[]`** — exactly two ends, each `{ entity, cardinality, role? }`. `role` is the navigation property name **at that entity** for reaching the other end.
- **Legacy: `source` + `target`** — asymmetric `{ entity, cardinality, name? }`. Retained as a fallback; resolvers prefer `ends[]` when present and synthesize it from `source`/`target` otherwise (`normalizeRelationshipEnds`).

```yaml
relationships:
  - uuid: rel-order-item-001
    description: Order has OrderItems
    type: structural               # structural | lineage (optional)
    ends:
      - { entity: 96a3ac78-…-212f6c, cardinality: one,  role: items }
      - { entity: c30df0bf-…-384255, cardinality: many, role: order }
    # source/target may also be present for backward compatibility
```

`cardinality` is `one` or `many`. A relationship may also carry a `stereotype` (whose `appliesTo` must be `relationship`) and `metadata`.

---

## 7. Metadata entries

Entities, attributes, relationships, packages, and case nodes carry typed metadata (`MetadataEntry`):

```yaml
metadata:
  - name: owner
    value: payments-team
  - name: pii
    value: { category: direct, retentionDays: 30 }   # values may nest (object/array)
    severity: warning                                  # optional: info|warning|error
```

`value` is recursive — scalars, arrays, or nested objects, serialised losslessly by YAML.

---

## 8. Stereotypes & schema-entities

A **stereotype** defines a metadata schema for an element type (`appliesTo`: `package` | `entity` | `attribute` | `model` | `relationship`).

Two storage forms exist:

1. **Legacy YAML** — `.dico/stereotypes.yaml`. In the eshop sample this is empty (`[]`).
2. **Schema-entities (canonical, #165)** — stereotype definitions expressed in the `Entity`/`Attribute` model, stored one per file under `.dico/schemas/<slug>.entity.yaml` and tagged `stereotype: metadata-schema`. The schema's metadata-fields become the stereotype's metadata definitions.

```yaml
# .dico/schemas/pii.entity.yaml
entities:
  - uuid: eacafa0f-e2c6-481c-ae89-b64b353ef94c
    name: pii
    description: Personally Identifiable Information
    stereotype: metadata-schema           # reserved marker for schema-entities
    metadata:
      - { name: appliesTo,   value: attribute }
      - { name: domain,      value: Privacy }
      - { name: displayName, value: PII }   # human label when it differs from the slug
    attributes:
      - { uuid: 4de2568a-…, name: pii-category,        type: string, required: true,  description: "direct | indirect | sensitive" }
      - { uuid: 17d38389-…, name: retention-days,      type: number, required: false, description: "Retention period in days" }
      - { uuid: f749559a-…, name: encryption-required, type: flag,   required: false, description: "Must be encrypted at rest" }
```

- The reserved metadata key `displayName` holds the human-readable name when it differs from the slug (`aggregate-root` → `Aggregate Root`).
- **UUID stability:** schema-entity UUIDs are generated once at migration time, committed to git, and never regenerated.

### 7.1 Reserved `system.*` metadata keys

Beyond `displayName`, two reserved keys on an element drive *views* (non-destructive; prefer the dedicated tools/UI over hand-editing):

| Key | Value | Effect |
|---|---|---|
| `system.hidden` | `"true"` / `"false"` | `"true"` hides the element from lists/diagrams/search/exports (#hide-model-data); `"false"` **pins it visible**, overriding any matching `hideRules[]`. Companions `system.hiddenReason` / `system.hiddenAt` are written by the Hide action. |
| `system.style` | a defined Element Style name | Explicitly styles the element in diagrams (#element-style), overriding `styleRules[]` and role detection. `auto` / `none` clears it. |

---

## 9. Rules

A `Rule` (`Rule.ts`) is a business/domain invariant — multi-attribute, conditional, or lifecycle logic that structure alone can't express. v1 stores the rule as a markdown `description`; an executable `expression` layer is deferred.

Rules live by **scope**:
- `scope: entity` → inlined on the entity as `entity.rules` (#106).
- `scope: package` → a `rules:` section in the package (conventionally `rules.model.yaml`).
- `scope: case` → on the owning case.
- `scope: global` → project-root `rules.yaml`.

```yaml
rules:
  - uuid: a77a3526-2fcb-40a9-be0b-69cd32ccb825
    name: order-total-positive          # kebab-case identifier
    description: |-
      ## Order total must be positive
      The `Order.totalAmount` field must always be **greater than zero**.
    severity: error                      # info | warning | error  (HOW BAD)
    enforcement: save                    # save | process | advisory  (WHEN checked)
    scope: package
    packageName: order-service
    targets:                             # 1+ ; UUID-based so renames don't break them
      - { kind: entity, uuid: order-service }
    tags: [data-quality, finance]
```

- `severity` (how bad) and `enforcement` (when checked) are **decoupled** (#76). `enforcement: process` binds to a process-stage via `metadata` keys `process-stage-field` / `process-stage-value`.
- `targets[].kind`: `attribute` | `entity` | `relationship` | `case-node`. Attribute targets carry `entityUuid`; case-node targets carry `casePath`.
- Do **not** synthesize rules from validation fields — the auto-synthesizer was removed in #85; everything it produced was already type metadata.

The Integrity page (`/integrity`) is the single pane that shows validation, constraints, and rules together.

---

## 10. Cases (business views)

A **case** (`Case` in `EntitySchema.ts`; the concept formerly called "perspective") is a business view over a subset of the model, resolved by BFS from root entities with path-based annotations. Lives in a `cases:` section, conventionally `<Name>.case.yaml`.

```yaml
cases:
  - uuid: 5a5b54d5-ce57-4af6-a47f-f369351d05f4
    name: Ordering
    description: Order lifecycle business process
    rootEntities: [96a3ac78-d30b-4bf5-bb61-bf3174212f6c]   # entity UUIDs to start BFS
    maxDepth: 5
    nodes:                                                  # path-scoped annotations
      - path: Order/totalAmount
        traverse: false        # set the frontier (stop expanding here)
        exclude:  false        # drop this path
        metadata:
          - { name: consistency-rule, value: Must equal sum of line items, severity: error }
    metadata: []
    rules: []                  # case-scoped rules (#74)
```

> The legacy `perspectives:` section name and the old project-root `perspectives/` folder are gone (#106); cases supersede them, though `perspectives:` is still accepted by the loader as a section name.

---

## 11. Actions (#179)

A named, typed sequence of flow steps modelling an entity behaviour — **modeling only in v1, not executed**. Stored in an `actions:` section, conventionally `<Name>.actions.yaml`. Steps and string fields are opaque (stored as-is).

```yaml
actions:
  - uuid: act-order-cancel
    name: cancel
    ownerRef: 96a3ac78-d30b-4bf5-bb61-bf3174212f6c   # must resolve to an entity UUID
    description: Cancel the order and optionally trigger a refund
    internal: false                                   # true = implementation detail, hidden
    params:
      - { name: reason, type: string, required: true }
    returns: { type: void }
    flow:
      - { kind: assign,       target: status, value: CANCELLED }
      - { kind: assign,       target: updatedAt, value: "@now" }
      - { kind: emitEvent,    name: order.cancelled }
      - kind: branch
        when: "paymentStatus == 'AUTHORIZED' || paymentStatus == 'PAID'"
        then:
          - { kind: invokeAction, actionRef: act-order-refund }
```

**`FlowStep` kinds** (`Action.ts`):

| `kind` | Fields |
|---|---|
| `assign` | `target`, `value` |
| `emitEvent` | `name` |
| `invokeAction` | `actionRef` (an action UUID, resolved within the package) |
| `branch` | `when`, `then[]`, `else?[]` |
| `wait` | `for` (event name or duration) |
| `callExternal` | `target`, `args?` (string map) |

---

## 12. State machines (#179)

Models an entity's lifecycle — states and transitions, transitions may invoke actions by UUID. **Modeling only in v1.** Multiple machines can exist on one entity (bound to different attributes). Stored in a `stateMachines:` section.

```yaml
stateMachines:
  - uuid: sm-order-fulfillment
    name: fulfillment
    ownerRef: 96a3ac78-d30b-4bf5-bb61-bf3174212f6c   # entity UUID
    description: Tracks the Order's delivery lifecycle
    stateAttribute: status                            # attribute on owner tracking state
    initialState: PENDING                             # must be a declared state
    states:
      - { name: PENDING }
      - { name: PROCESSING }
      - { name: SHIPPED }
      - { name: DELIVERED, terminal: true }           # sinks — no outgoing transitions
      - { name: CANCELLED, terminal: true }
    transitions:
      - { uuid: tr-f-1, from: PENDING,    to: PROCESSING, on: "payment.authorized", invoke: [act-order-reserveStock] }
      - { uuid: tr-f-2, from: PROCESSING, to: SHIPPED,    on: "shipment.created", guard: "stockAvailable", invoke: [act-order-notifyShipped] }
      - { uuid: tr-f-4, from: "*",        to: CANCELLED,  on: "order.cancel", guard: "not terminal", invoke: [act-order-cancel] }
```

- `from: "*"` is the wildcard — taken from any non-terminal state when its event fires.
- `guard` is opaque (not evaluated in v1); `invoke[]` is an ordered list of action UUIDs, resolved post-merge within the package.
- Load-time invariants: unique state names, `initialState`/`from`/`to` reference declared states (or `*`), `(ownerRef, name)` unique per entity, all `invoke[]` UUIDs resolve to known actions.

---

## 13. Diagrams

Saved visualization layouts, stored as JSON under `.dico/diagrams/<id>.json`. Consumed by the Cytoscape.js-based visualization views; not part of the domain model.

---

## 14. ORM mapping metadata (reserved `orm.*` keys)

A reusable **`orm.*` metadata namespace** captures object-relational mapping intent that can't be derived from structure alone. The concepts and value vocabulary are **borrowed from JPA** (the most complete, widely-understood mapping model), but the namespace is deliberately language/vendor-neutral — the same metadata could drive a JPA, EF Core, SQLAlchemy, etc. mapping. It rides on the existing `metadata[]` arrays — exactly the prefix convention used by `physical.*` — so it is **additive and optional**: a model with no `orm.*` keys is unaffected, and no core schema changes.

The model already carries the *structural* facts (entity/table names, column names + DB types + nullability via the `physical.*` keys §5/§7, `primaryKey`, one/many cardinality §6, foreign keys with `ON DELETE/UPDATE` via `PhysicalConstraint`, and validation). The `orm.*` keys add the rest, so the dico can *bear* a full mapping. Generating actual ORM/JPA code is a separate concern, not part of the format. Anything not set falls back to conventions: package inferred from the package/service name, table/column names from `physical.*` or `snake_case`, target type from a standard `AttributeType` table (e.g. `uuid`→`UUID`, `timestamp`→`Instant`, `number`+scale→`BigDecimal`).

**Entity `metadata[]`**

| key | value | maps to |
|---|---|---|
| `orm.package` | string | class package (`@Entity` FQN) |
| `orm.className` | string | class-name override (default: entity name) |
| `orm.embeddable` / `orm.mappedSuperclass` | flag | `@Embeddable` / `@MappedSuperclass` |
| `orm.extends` | entity name or uuid | supertype (inheritance) — must resolve to an entity |
| `orm.inheritanceStrategy` | `SINGLE_TABLE` \| `JOINED` \| `TABLE_PER_CLASS` | `@Inheritance` (on the root) |
| `orm.discriminatorColumn` / `orm.discriminatorValue` | string | `@DiscriminatorColumn` / `@DiscriminatorValue` |
| `orm.idClass` / `orm.embeddedId` | string / attr name | composite key |

**Attribute `metadata[]`**

| key | value | maps to |
|---|---|---|
| `orm.javaType` | string | explicit Java type override |
| `orm.generatedValue` | `IDENTITY` \| `SEQUENCE` \| `TABLE` \| `UUID` \| `AUTO` \| `NONE` | `@GeneratedValue` |
| `orm.sequenceName` / `orm.allocationSize` | string / int | `@SequenceGenerator` |
| `orm.enumerated` / `orm.enumType` | `STRING` \| `ORDINAL` / class | `@Enumerated` (only on `type: enum`) |
| `orm.version` / `orm.transient` / `orm.lob` | flag | `@Version` / `@Transient` / `@Lob` (`version`+`transient` are mutually exclusive) |
| `orm.temporal` | `DATE` \| `TIME` \| `TIMESTAMP` | `@Temporal` |
| `orm.converter` | class | `@Convert` |
| `orm.elementCollection` / `orm.embedded` | flag | `@ElementCollection` / `@Embedded` |

**Relationship `metadata[]`**

| key | value | maps to |
|---|---|---|
| `orm.fetch` | `LAZY` \| `EAGER` | fetch type |
| `orm.cascade` | list of `ALL`/`PERSIST`/`MERGE`/`REMOVE`/`REFRESH`/`DETACH` (comma-separated or YAML list) | cascade |
| `orm.orphanRemoval` / `orm.optional` | flag | orphanRemoval / optional |
| `orm.mappedBy` / `orm.owningEnd` | string | owning side when no backing FK constraint |
| `orm.joinTable` / `orm.joinColumns` / `orm.inverseJoinColumns` | string(s) | `@JoinTable` for `many`/`many` |

```yaml
entities:
  - name: Order
    metadata:
      - { name: physical.tableName, value: orders }        # @Table — owned by physical.*
      - { name: physical.schema,    value: commerce }
      - { name: orm.package,        value: com.eshop.order }
      - { name: orm.className,      value: Order }
    attributes:
      - name: id
        type: string
        metadata:
          - { name: orm.generatedValue, value: UUID }
      - name: status
        type: enum
        validation: { enumValues: [PENDING, SHIPPED, DELIVERED] }
        metadata:
          - { name: orm.enumerated, value: STRING }
          - { name: orm.enumType,   value: OrderStatus }
# relationships.model.yaml
relationships:
  - uuid: rel-order-item-001
    metadata:
      - { name: orm.fetch,         value: LAZY }
      - { name: orm.cascade,       value: ALL }
      - { name: orm.orphanRemoval, value: true }
    ends: [ … ]
```

`validate:dico` (below) checks `orm.*` values: enum membership (`orm.fetch`/`cascade`/`generatedValue`/`enumerated`/`temporal`/`inheritanceStrategy`), `orm.extends` resolves to an entity, mutually-exclusive flags, and `orm.enumerated` only on `enum` attributes. Unknown `orm.*` keys are flagged as warnings.

### Embeddable value objects

An `@Embeddable` value object (e.g. an `Address` reused for shipping & billing) is modelled as a normal entity that carries `orm.embeddable: true`, and is **referenced from the owner via an attribute** rather than a relationship:

- the embeddable entity holds the canonical fields plus `orm.embeddable: true`;
- the owner's attribute is `type: object` with `orm.embedded: true` and `orm.javaType: <EmbeddableName>` (the embeddable class) — instead of inlining `properties`.

```yaml
# Address.model.yaml — the embeddable
entities:
  - uuid: …
    name: Address
    metadata: [ { name: orm.embeddable, value: true } ]
    attributes: [ … ]            # canonical fields (fullName, street, …)

# Order.model.yaml — the owner references it
- name: shippingAddress
  type: object
  metadata:
    - { name: orm.embedded, value: true }
    - { name: orm.javaType, value: Address }
```

The diagram reads this both ways: structural / ORM views draw a **composition** edge from owner to embeddable (`Order ◆— Address`), while the **physical** view gives the embeddable no table of its own — its columns are flattened into the owner's table (e.g. `shippingAddress.street`), since `@Embedded` is stored inline.

### Editing in the app

You normally don't hand-edit these keys — the app provides typed editors driven by the **same vocabulary** the validator uses (`GET /api/orm/vocabulary`, sourced from `backend/src/models/ormVocabulary.ts`), so the UI and validation can't drift. Inputs are typed per key: enum → dropdown, flag → checkbox, `orm.cascade` → multi-select, `orm.extends` → entity picker.

- **Entity** — a dedicated **ORM** tab on the entity page (between *Metadata* and *Lineage*). It shows, top to bottom:
  - a **Physical** section — a typed editor for `physical.tableName` / `physical.schema` (the `@Table` mapping; table/column names stay owned by `physical.*`, kept distinct from `orm.*`);
  - the **ORM mapping** form — the entity-scope keys above, rendered up-front and prefilled;
  - an **inheritance** panel (ancestor/subclass chain resolved from `orm.extends`);
  - a read-only **Relationships (ORM)** overview listing each relationship's `orm.*` (fetch / cascade / mappedBy …) with a link to edit it.

  Entities with no `orm.*` show an **Enable ORM mapping** affordance instead of the form.
- **Attribute** — an **ORM mapping** section on the attribute detail page (after its *Physical* section), rendering the attribute-scope keys.
- **Relationship** — an **ORM mapping** section on the relationship detail page (after its *Physical* section), rendering the relationship-scope keys.

All three open as the full typed form and persist by rewriting the element's `metadata[]` (every non-`orm.*` key is preserved). Saving an attribute/relationship/entity round-trips through the normal write path, so the YAML reflects the change immediately.

---

## Validating a project

Before opening a project in the app, you can check it for the errors the
loader would otherwise raise at load time (collisions, unresolved
relationship endpoints, malformed UUIDs, circular derived types, dangling
action/state-machine references) with the standalone validator:

```bash
cd backend
npm run validate:dico -- /path/to/your-project      # folder with dico.config.json
# or, against the bundled sample:
npm run validate:dico -- ../samples/eshop
# defaults to $DATA_DIR / the dev sample when no path is given:
npm run validate:dico
npm run validate:dico -- --help
```

It runs the **same** loader and validators the application uses
(`mergePackageSections`, `validateEntity`, `normalizeRelationship`,
`validateRule`, the derived-types graph check) and adds explicit
cross-reference resolution. Findings are grouped into **errors** and
**warnings** with file paths and identifiers; the command exits non-zero
when any error is found (warnings alone exit 0). Script:
`backend/src/scripts/validateDico.ts`.

---

## See also

- `CLAUDE.md` — architecture overview and the concept-level rationale (#85, #106, #107).
- `docs/deployment.md` — desktop vs. server file layout and configuration.
- `docs/api-reference.md` + Swagger UI at `/api-docs` — the REST surface.
- `samples/eshop/` — a complete worked project exercising every section above.
- `backend/src/models/` — the TypeScript types and JSON Schema validators that define this format.
