/**
 * formatModelOutlineWithinBudget() — the per-turn model snapshot injected into
 * the system prompt, kept within MODEL_OUTLINE_MAX_CHARS (#grounding at scale).
 *
 * The contract is all-or-nothing per layer: under the budget the FULL outline
 * (every entity name) goes in verbatim; over it the outline switches to a
 * compact form (package names + counts, NO entity names) with an explicit
 * banner telling the model the lists were omitted and how to locate anything
 * (searchModel → getEntityDetails / getSqlSchema entityNames). A silently
 * mid-truncated entity listing is the one forbidden outcome — the model would
 * trust a partial picture as complete.
 */
import {
  formatModelOutline,
  formatModelOutlineWithinBudget,
  MODEL_OUTLINE_MAX_CHARS,
} from '../aiController.js';

/** Overview fixture: `pkgCount` packages × `entPerPkg` entities with distinctive names. */
function overview(pkgCount: number, entPerPkg: number) {
  return {
    summary: 'fixture',
    totals: {
      packages: pkgCount, entities: pkgCount * entPerPkg, relationships: 0,
      cases: 0, rules: 0, events: 0, actions: 0, stateMachines: 0,
      derivedTypes: 0, stereotypes: 0,
    },
    packages: Array.from({ length: pkgCount }, (_, i) => ({
      name: `package-${i}`,
      // "Zz9" marker: appears in every entity name and nowhere else,
      // so its absence proves NO entity name (whole or cut-off) leaked out.
      entities: Array.from({ length: entPerPkg }, (_, j) => `EntityZz9_${i}_${j}`),
      relationships: 0,
    })),
    stereotypes: [], derivedTypes: [], cases: [],
  } as any;
}

describe('formatModelOutlineWithinBudget', () => {
  it('small model → the full outline, byte-identical to formatModelOutline', () => {
    const o = overview(3, 5);
    const text = formatModelOutlineWithinBudget(o);
    expect(text).toBe(formatModelOutline(o));
    expect(text).toContain('EntityZz9_0_0'); // entity names present
    expect(text.length).toBeLessThanOrEqual(MODEL_OUTLINE_MAX_CHARS);
  });

  it('large model (40 pkgs × 75 entities) → compact mode: counts only, no entity names, within budget', () => {
    const text = formatModelOutlineWithinBudget(overview(40, 75));
    expect(text.length).toBeLessThanOrEqual(MODEL_OUTLINE_MAX_CHARS);
    // explicit banner with the totals and the discovery path
    expect(text).toContain('Entity lists omitted (3000 entities across 40 packages');
    expect(text).toContain('searchModel');
    // package lines carry counts…
    expect(text).toContain('- package-0: 75 entities, 0 relationships');
    expect(text).toContain('- package-39: 75 entities');
    // …and not a single entity name
    expect(text).not.toContain('Zz9');
  });

  it('compact mode tells the model NOT to guess names', () => {
    const text = formatModelOutlineWithinBudget(overview(40, 75));
    expect(text).toMatch(/do NOT guess entity, package, or table names/i);
    expect(text).toMatch(/getEntityDetails|getSqlSchema/);
  });

  it('extreme model (300 packages) → package tail collapses into "+N more packages"', () => {
    const text = formatModelOutlineWithinBudget(overview(300, 10));
    expect(text.length).toBeLessThanOrEqual(MODEL_OUTLINE_MAX_CHARS);
    expect(text).toMatch(/\+\d+ more packages/);
    expect(text).toContain('listEntities'); // how to enumerate the collapsed tail
    expect(text).toContain('Entity lists omitted (3000 entities across 300 packages');
    // head + at least the first package line survive
    expect(text).toContain('Current model snapshot — 300 package(s)');
    expect(text).toContain('- package-0: 10 entities');
  });

  it('collapsed package counts add up (shown lines + "+N more" == total)', () => {
    const text = formatModelOutlineWithinBudget(overview(300, 10));
    const shown = (text.match(/^ {2}- package-\d+:/gm) ?? []).length;
    const more = Number(text.match(/\+(\d+) more packages/)?.[1]);
    expect(shown + more).toBe(300);
  });

  it('honours a custom maxChars budget', () => {
    const o = overview(10, 8);
    const full = formatModelOutline(o);
    // generous budget → full outline
    expect(formatModelOutlineWithinBudget(o, full.length)).toBe(full);
    // tight budget → compact, still bounded
    const tight = formatModelOutlineWithinBudget(o, 900);
    expect(tight).toContain('Entity lists omitted');
    expect(tight).not.toContain('Zz9');
    expect(tight.length).toBeLessThanOrEqual(900);
  });

  it('stays within budget at edge sizes around the tail-collapse boundary', () => {
    // Sizes that previously overshot by a few chars when the collapse-line
    // reserve was too small (204×5 was the worst offender at +9).
    for (const [pkgs, ents] of [[204, 5], [500, 3], [1000, 2], [120, 30], [60, 60]] as const) {
      const text = formatModelOutlineWithinBudget(overview(pkgs, ents));
      expect(text.length).toBeLessThanOrEqual(MODEL_OUTLINE_MAX_CHARS);
      // tail-collapse (when present) must still account for every package
      const more = text.match(/\+(\d+) more packages/);
      if (more) {
        const shown = (text.match(/^ {2}- package-\d+:/gm) ?? []).length;
        expect(shown + Number(more[1])).toBe(pkgs);
      }
    }
  });

  it('NEVER silently mid-truncates: output is either the exact full outline or carries the banner', () => {
    // sweep across the full/compact threshold and the tail-collapse threshold
    for (const [pkgs, ents] of [[1, 3], [5, 10], [20, 10], [40, 20], [80, 40], [150, 10], [300, 10]] as const) {
      const o = overview(pkgs, ents);
      const text = formatModelOutlineWithinBudget(o);
      const full = formatModelOutline(o);
      if (text !== full) {
        // compact mode must be explicit about the omission and leak no entity name,
        // whole or cut off at the boundary
        expect(text).toContain('Entity lists omitted');
        expect(text).not.toContain('Zz9');
      }
    }
  });
});
