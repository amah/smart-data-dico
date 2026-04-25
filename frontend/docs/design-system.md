# Design system

The canonical reference is the live page: **`/design-system`** in the running app.

It renders every token and every `frontend/src/components/ui/*` primitive
in both Calm and Bold variants, so it can never go out of date — if a
token is renamed or a primitive is removed, the page breaks the build.

## When you're adding a new component

Three rules that don't show up by reading the primitives:

1. **Primitives over Tailwind/DaisyUI.** New components consume
   `frontend/src/components/ui/`. Reach for `btn-*` or `bg-base-100`
   only when you're migrating legacy code; don't introduce them in new
   files.

2. **Tokens, not hex.** Inline styles use `var(--bg-raised)`, not
   `#ffffff`. Variants and themes live in `frontend/src/styles/tokens.css` —
   the rest of the codebase just references them. If you need a colour
   that doesn't exist as a token, add the token first.

3. **Sticky header on full-page tables, off in tab-embedded ones.**
   `EntityFlatTable` / `AttributeFlatTable` / `PackageFlatTable` /
   `RuleBrowserPage` set `stickyHeader`; `AttributeList` /
   `RelationshipList` don't because they live inside an `EntityDetail`
   tab and a sticky header would compete with the page scroll.

## Adding a primitive

When you add a new primitive to `ui/`, drop a section in
`frontend/src/pages/DesignSystemPage.tsx` showing its variants in a
`<Surface>` block. The page is the audit trail.
