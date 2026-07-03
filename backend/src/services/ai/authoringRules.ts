/**
 * Canonical Smart Data Dictionary **authoring rules** — the single source of truth
 * for the format contract the AI agents must follow when creating/changing model
 * elements. The integrated in-app agent injects this into its system prompt (both
 * provider paths, designer mode); the external Claude Code skill mirrors it in
 * `docs/SKILL.md` / `docs/format-reference.md`. A sync test keeps the doc and this
 * module from drifting on the key constructs.
 *
 * Keep it concise — it is prepended to every authoring turn.
 */
export const AUTHORING_RULES = `AUTHORING RULES — Smart Data Dictionary file format. Follow exactly when creating or changing model elements (prefer the dedicated tools; these rules govern what a valid result looks like):

- UUIDs: every entity, attribute (including nested properties/items), relationship, rule, and case has a real UUID (v1–v5). Never hand-type hex — the tools generate them. Identifiers are unique across the WHOLE package, not per file: a duplicate entity name, or a duplicate rule/case/relationship UUID anywhere in the package, is a hard load error.
- References are UUID-based, never name-based, so renames don't break links. Every reference (relationship ends, rule targets, action/state-machine ownerRef) must resolve within the package.
- Keep the three governance concepts SEPARATE — never collapse them: Validation (attribute.validation — pattern, maxLength, enumValues, minimum…) vs Constraint (entity.constraints[] — unique, check, foreignKey, index; DB-enforced) vs Rule (a first-class business invariant across fields/lifecycle). type: enum → allowed values live in validation.enumValues, not a separate field.
- Conceptual vs physical stay distinct: author logical names (PascalCase entities, camelCase attributes, logical/derived types); physical.* holds table/column names and dbTypes. Never write SQL/DDL with conceptual names.
- Reserved metadata keys you may set on an element: system.hidden ("true" hides it from lists/diagrams/exports; "false" pins it visible over any rule) and system.style (a defined Element Style name → styles it in diagrams). Prefer the hide / element-style tools over writing these metadata keys directly.
- Project config in dico.config.json carries: types[] (reusable derived attribute types), hideRules[] (glob/regex that bulk-hide reverse-engineering waste), and elementStyles[] + styleRules[] (named diagram styles bound to roles). Manage these with the dedicated tools (createDerivedType, defineElementStyle, addStyleRule) rather than editing config blindly.`;
