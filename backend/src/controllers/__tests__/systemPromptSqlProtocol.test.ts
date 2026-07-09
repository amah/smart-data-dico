/**
 * The SQL-generation protocol in the standing system prompt (#grounding).
 * Light-touch string containment via standingSystemPrompt() — the exported
 * seam that returns the canonical SYSTEM_PROMPT body plus suffixes. Guards
 * the load-bearing instructions: searchModel FIRST (never guess names),
 * narrow getSqlSchema scoping via entityNames, and passing the
 * physicalMappingMissing flag on to the user.
 */
import { standingSystemPrompt } from '../aiController.js';

describe('standing system prompt — SQL protocol', () => {
  const prompt = standingSystemPrompt();

  it('has a dedicated SQL-generation protocol section', () => {
    expect(prompt).toContain('Generating database queries');
  });

  it('step 1 mandates locating the entity via searchModel before anything else', () => {
    // the LOCATE step is numbered 1 and names searchModel within it
    expect(prompt).toMatch(/1\. LOCATE the entity first[\s\S]{0,300}?searchModel/);
    expect(prompt).toMatch(/NEVER guess a package, entity, or table name/);
  });

  it('step 2 tells the model to scope getSqlSchema narrowly with entityNames', () => {
    expect(prompt).toMatch(/getSqlSchema scoped NARROWLY/);
    expect(prompt).toMatch(/entityNames: \[\.\.\.\]/);
    expect(prompt).toMatch(/Do not call it unscoped on a large model/);
  });

  it('mandates surfacing physicalMappingMissing fallbacks to the user', () => {
    expect(prompt).toContain('physicalMappingMissing');
    expect(prompt).toMatch(/unverified fallbacks/);
  });

  it('tells the model to follow tool-error guidance instead of retrying the same guess', () => {
    expect(prompt).toMatch(/do not retry the same guess/);
  });
});
