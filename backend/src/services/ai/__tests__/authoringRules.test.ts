/**
 * The shared authoring rules (single source of truth for the format contract the
 * in-app agent follows) must cover the key constructs, and must not drift from the
 * doc the external Claude Code skill reads (`docs/format-reference.md`).
 */
import fs from 'fs';
import path from 'path';
import { AUTHORING_RULES } from '../authoringRules.js';

// Constructs that MUST appear in both the agent rules and the format spec.
const CONSTRUCTS = ['system.hidden', 'system.style', 'hideRules', 'elementStyles', 'styleRules'];

describe('AUTHORING_RULES', () => {
  it('covers the reserved keys + config sections and the core hard rules', () => {
    for (const c of CONSTRUCTS) expect(AUTHORING_RULES).toContain(c);
    expect(AUTHORING_RULES).toMatch(/UUID/);
    expect(AUTHORING_RULES.toLowerCase()).toContain('unique across the whole package');
    // the three governance concepts are named
    for (const k of ['Validation', 'Constraint', 'Rule']) expect(AUTHORING_RULES).toContain(k);
  });

  it('does not drift from docs/format-reference.md on the new constructs', () => {
    const doc = fs.readFileSync(path.resolve(process.cwd(), '../docs/format-reference.md'), 'utf8');
    for (const c of CONSTRUCTS) expect(doc).toContain(c);
  });
});
