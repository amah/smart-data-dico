# Element Style

Style model elements by their **role** so large models (1000+ entities) stay
readable — aggregate roots emphasized, relation/junction tables muted, reference
and remote tables visually distinct. Styling is **derived**, never hand-painted per
node.

## The scaling principle
The Cytoscape stylesheet already styles by **data-attribute selectors**
(`node[type="entity"]`, `node[pkCount>0]`, `node[type="jointable"]`). We reuse
that: classify each element **once** into a `styleName` data field (O(n) at
element-build time), and let Cytoscape's indexed `node[styleName="…"]` selectors do
the rendering in constant time. You define a handful of styles + rules once —
never per node.

## 1. Named styles — `dico.config.json.elementStyles[]`
Same config pattern as `hideRules` / `types`. Colors are **theme tokens**
(`primary`, `neutral`, `warning`, `*-subtle`, …) so dark/light both work.

```json
"elementStyles": [
  { "name": "aggregate-root", "label": "Aggregate Root", "fill": "primary-subtle",
    "border": "primary", "borderWidth": 4, "shape": "round-rectangle", "badge": "AR", "emphasis": true },
  { "name": "junction",  "label": "Relation table",     "fill": "neutral-subtle", "shape": "hexagon", "opacity": 0.7 },
  { "name": "reference", "label": "Reference / lookup",  "border": "neutral",  "borderStyle": "dashed" },
  { "name": "remote-ref","label": "Remote reference",    "border": "warning", "borderStyle": "dotted", "fill": "warning-subtle" }
]
```

Fields: `name` (stable id), `label`, `fill`, `border`, `borderWidth`,
`borderStyle` (solid|dashed|dotted), `shape`, `opacity`, `textColor`, `badge`
(short tag), `emphasis` (z-order boost + halo), `default` (mark **one** style as
the fallback — applied to any element no rule/role/stereotype styles; e.g. a
neutral-grey base so unstyled entities look uniform).

## 2. Binding — resolved by precedence into `styleName`
Highest wins:
1. **Explicit override** — `system.style: <name>` metadata on the element.
2. **Style rule** — `styleRules[]` (declarative): match by `stereotype` / `role` /
   `entityName` / `physicalTableName` (glob default, regex opt-in) → a style name.
3. **Auto role detector** — a detected role maps to the same-named style if one exists.
4. Default (unstyled).

```json
"styleRules": [
  { "match": "stereotype",        "pattern": "aggregate-root", "style": "aggregate-root" },
  { "match": "physicalTableName", "pattern": "*_link",         "style": "junction" }
]
```

## 3. Auto role detectors (zero-tagging value at scale)
- **junction** — a relation/link table (already detected as `type:'jointable'`).
- **reference** — an FK-*target only* (fk-in-degree > 0, fk-out-degree == 0): lookup/reference table.
- **remote-ref** — a cross-package / cross-repo target (the reverse-engineer stamps `re.repos` + the cross-repo report).
- **aggregate-root** — reliably a **stereotype** the modeller assigns; the style follows it (the eshop sample already has an `aggregate-root` stereotype).

Stereotype stays the primary *human* tag; rules + detectors cover the rest with no per-node work.

## 4. Surfaces
- **Diagrams** — full styling (fill/border/shape/badge) + a clickable **legend**
  with live counts (`aggregate-root: 12 · junction: 340 · …`) to isolate/highlight a role.
- **Lists / search** — a small colored **badge** per row.

## Architecture
- **Config CRUD (backend)** — `elementStyles[]` + `styleRules[]` in `dico.config.json`
  with list/replace/validate + `GET/PUT /api/config/element-styles|style-rules`.
- **Resolver (frontend)** — `utils/elementStyle.ts`: `compileStyleRules`,
  `detectRole(signals)`, `resolveStyleName(element, signals, styles, rules)`. Runs at
  element-build time; the only consumer is the visualization + list badge, so a single
  frontend resolver (no backend duplicate).

## Slices
1. **Config + resolver + detectors + tests.** ← delivered first (#212)
2. Wire `styleName` into element builders (`physicalElements.ts` / `logicalElements.ts`)
   + generate stylesheet selectors from the named styles + the legend.
3. Style-manager UI (define styles, bind rules, live counts) + the list badge.

Composes with the hide feature (`dico.config.json` + resolve-at-build-time shape).
