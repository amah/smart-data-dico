/**
 * Unit tests for the tool-category resolver and the gating predicate.
 *
 * `resolveToolCategory` maps a tool name (+ MCP trust map) to one of
 * read | navigate | create | modify | delete. `isGatedCategory` then
 * decides whether that category must pass through the server-side
 * approval gate (create | modify | delete) or runs freely (read | navigate).
 *
 * Acceptance criteria 6–9.
 */

import { resolveToolCategory, isGatedCategory } from '../aiController';

const noTrust = new Map<string, 'auto' | 'review'>();

describe('resolveToolCategory + isGatedCategory', () => {
  // AC6: builtin reads + navigate are not gated.
  it('classifies builtin read tools as "read" (not gated)', () => {
    for (const name of ['listEntities', 'getEntityDetails', 'listStereotypes', 'listRoutes']) {
      const cat = resolveToolCategory(name, noTrust);
      expect(cat).toBe('read');
      expect(isGatedCategory(cat)).toBe(false);
    }
  });

  it('classifies navigateTo as "navigate" (not gated)', () => {
    const cat = resolveToolCategory('navigateTo', noTrust);
    expect(cat).toBe('navigate');
    expect(isGatedCategory(cat)).toBe(false);
  });

  // AC7: builtin writes are gated.
  it('gates builtin create/modify/delete tools', () => {
    const cases: Array<[string, string]> = [
      ['createEntity', 'create'],
      ['createRelationship', 'create'],
      ['updateEntity', 'modify'],
      ['updateRelationship', 'modify'],
      ['deleteEntity', 'delete'],
      ['deleteRelationship', 'delete'],
    ];
    for (const [name, expected] of cases) {
      const cat = resolveToolCategory(name, noTrust);
      expect(cat).toBe(expected);
      expect(isGatedCategory(cat)).toBe(true);
    }
  });

  // AC8: MCP tool trust drives the category.
  it('maps an MCP tool with trust "auto" to "read" (not gated)', () => {
    const trust = new Map<string, 'auto' | 'review'>([['some-conn.search', 'auto']]);
    const cat = resolveToolCategory('some-conn.search', trust);
    expect(cat).toBe('read');
    expect(isGatedCategory(cat)).toBe(false);
  });

  it('maps an MCP tool with trust "review" to "modify" (gated)', () => {
    const trust = new Map<string, 'auto' | 'review'>([['some-conn.search', 'review']]);
    const cat = resolveToolCategory('some-conn.search', trust);
    expect(cat).toBe('modify');
    expect(isGatedCategory(cat)).toBe(true);
  });

  it('maps an MCP tool absent from the trust map to "modify" (gated default)', () => {
    const cat = resolveToolCategory('unknown-conn.tool', noTrust);
    expect(cat).toBe('modify');
    expect(isGatedCategory(cat)).toBe(true);
  });

  // AC9: unknown non-MCP tool defaults to modify (gated).
  it('defaults an unknown non-MCP tool to "modify" (gated)', () => {
    const cat = resolveToolCategory('somethingWeird', noTrust);
    expect(cat).toBe('modify');
    expect(isGatedCategory(cat)).toBe(true);
  });

  it('strips a "functions." prefix and ":n" call-index suffix before resolving', () => {
    expect(resolveToolCategory('functions.listEntities:2', noTrust)).toBe('read');
    expect(resolveToolCategory('createEntity:0', noTrust)).toBe('create');
  });
});
