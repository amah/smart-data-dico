/**
 * Tests for getToolCategory (#59) — the helper that maps tool names to
 * their auto-approve category. The mapping is the single source of truth;
 * the frontend reads `category` off the SSE event rather than keeping its
 * own copy of the switch.
 */
jest.mock('../../utils/logger');
jest.mock('../../utils/appDir', () => ({
  CONFIG_FILE: '/tmp/test-dico-app.json',
  getConfigSection: jest.fn(),
  setConfigSection: jest.fn(),
}));
jest.mock('../../services/conversationService', () => ({
  conversationService: { list: jest.fn(), get: jest.fn(), save: jest.fn(), delete: jest.fn() },
}));

import { getToolCategory } from '../aiController.js';

describe('getToolCategory (#59)', () => {
  it('classifies inspection tools as `read`', () => {
    expect(getToolCategory('listEntities')).toBe('read');
    expect(getToolCategory('listStereotypes')).toBe('read');
    expect(getToolCategory('getEntityDetails')).toBe('read');
    expect(getToolCategory('listPackages')).toBe('read');
  });

  it('classifies navigateTo as `navigate`', () => {
    expect(getToolCategory('navigateTo')).toBe('navigate');
  });

  it('classifies createEntity / createRelationship as `create`', () => {
    expect(getToolCategory('createEntity')).toBe('create');
    expect(getToolCategory('createRelationship')).toBe('create');
  });

  it('classifies future update tools as `modify`', () => {
    expect(getToolCategory('updateEntity')).toBe('modify');
    expect(getToolCategory('updateRelationship')).toBe('modify');
  });

  it('classifies future delete tools as `delete`', () => {
    expect(getToolCategory('deleteEntity')).toBe('delete');
    expect(getToolCategory('deleteRelationship')).toBe('delete');
  });

  it('strips the `functions.` prefix some providers prepend', () => {
    expect(getToolCategory('functions.listEntities')).toBe('read');
    expect(getToolCategory('functions.createEntity')).toBe('create');
  });

  it('strips the `:n` suffix the AI SDK appends to repeated calls', () => {
    expect(getToolCategory('listEntities:0')).toBe('read');
    expect(getToolCategory('createEntity:2')).toBe('create');
    expect(getToolCategory('functions.createRelationship:1')).toBe('create');
  });

  it('falls back to `modify` for unknown tool names — never to `read`', () => {
    // `modify` is the cautious default: better to prompt the user than
    // auto-approve a side effect we didn't plan for.
    expect(getToolCategory('mysteryNewTool')).toBe('modify');
    expect(getToolCategory('')).toBe('modify');
  });
});
