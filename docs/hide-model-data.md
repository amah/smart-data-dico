# Hide model data (declutter reverse-engineering noise)

Reverse-engineering a database often surfaces **waste** — backup, temp, staging,
and dated-snapshot tables (`orders_bak`, `tmp_import`, `orders_20240101`) — that
pollutes the dictionary. This feature lets you **hide** such elements so they drop
out of lists, diagrams, search, exports, and AI grounding, without deleting them.

## Principles
- **Non-destructive & reversible.** Hidden ≠ deleted. Files stay on disk; hiding is
  a view policy. (Deleting RE waste is futile — the next run re-creates it.)
- **Survives RE re-runs.** The hidden flag is preserved by the idempotent merge.
- **Git-visible / auditable.** The flag lives in the element's YAML; rules live in
  `dico.config.json`.

## How an element becomes hidden

Two complementary layers, combined as:

> `effectiveHidden = pinnedVisible ? false : (explicitFlag || matchesAnyRule)`

**1. Explicit per-element flag** — a reserved metadata key:
```yaml
metadata:
  - { name: system.hidden,       value: "true" }   # "false" PINS visible (overrides rules)
  - { name: system.hiddenReason, value: "backup table" }
  - { name: system.hiddenAt,     value: "2026-07-02" }
```

**2. Declarative hide rules** — `dico.config.json.hideRules[]`, matched (glob by
default, or regex) against the physical table name, entity name, or package:
```json
"hideRules": [
  { "match": "physicalTableName", "pattern": "*_bak",       "reason": "backup" },
  { "match": "entityName",        "pattern": "tmp_*" },
  { "match": "physicalTableName", "pattern": "_[0-9]{8}$", "regex": true, "reason": "dated snapshot" }
]
```
A rule declutters the whole model at once, including future RE output — add
`*_bak` / `tmp_*` and the waste disappears live. `system.hidden: "false"` pins an
individual element visible even if a rule would hide it.

## Enforcement
The engine is `backend/src/services/visibilityService.ts`
(`compileHideRules`, `isEntityHidden`, `filterHiddenEntities`). Read paths exclude
hidden by default and take `includeHidden` only when the user asks to see them:
- `GET /api/services/:service/entities` → `?includeHidden=true` (via
  `serviceService.getVisibleServiceEntities`). `getServiceEntities` itself stays
  unfiltered so internal graph logic (relationships, impact) keeps the full set.
- Views that load via package data filter client-side with the mirrored
  `frontend/src/utils/visibility.ts`.

## API
- `PUT /api/services/:service/entities/:entity/hidden` `{ hidden, reason? }` — hide/unhide (ADMIN/EDITOR).
- `GET/PUT /api/config/hide-rules` — read/replace the rules (validated: known `match`, non-empty `pattern`, compilable regex).

## UI
- **Show hidden** toggle (persisted) + per-row **Hide/Unhide** action in the entity
  flat table; hidden rows render muted when shown.

## Decisions (agreed)
- **Soft-hide only** — no permanent delete in this feature.
- **Per-element flag + pattern rules** — both mechanisms.
- **RE waste = triage, pre-selected** — the planned RE integration shows suggested
  waste pre-checked for the user to confirm (nothing hidden silently).

## Delivered vs. follow-up
**Delivered:** the visibility engine (flag + rules, pin-visible override,
glob/regex), the REST filter + `includeHidden`, hide/unhide + hide-rules endpoints,
and the flat-table UI (Show-hidden toggle + Hide/Unhide).

**Follow-up slices:** package-level explicit hide; enforcement inside the FS
projection / sidebar tree, perspective BFS, exports, and AI grounding beyond the
REST endpoint; a dedicated **Hidden-Items manager** page + a **hide-rules editor**
with live "N would be hidden" preview; and the **RE triage** panel (waste
heuristics pre-selected in the run results).
