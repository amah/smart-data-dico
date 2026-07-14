/**
 * Tests for the chat-mode helpers shipped in #55: validation,
 * tool gating, system-prompt suffix, and tool-map filtering. The
 * helpers are the contract — every code path that respects the
 * mode (AI SDK streamText, OpenAI-compatible direct client,
 * conversation persistence) routes through these.
 */
jest.mock('../../utils/logger');
jest.mock('../../utils/appDir', () => ({
  CONFIG_FILE: '/tmp/test-dico-app.json',
  getConfigSection: jest.fn(),
  setConfigSection: jest.fn(),
}));
jest.mock('../../services/conversationService', () => ({
  conversationService: { list: jest.fn(), get: jest.fn(), save: jest.fn(), delete: jest.fn(), patch: jest.fn() },
}));

import {
  AI_CHAT_MODES,
  filterToolsForMode,
  getModeSystemSuffix,
  isToolAllowedForMode,
  isValidMode,
} from '../aiController.js';

describe('chat modes (#55)', () => {
  describe('isValidMode', () => {
    it('accepts the three documented modes', () => {
      expect(isValidMode('designer')).toBe(true);
      expect(isValidMode('ask')).toBe(true);
      expect(isValidMode('review')).toBe(true);
    });

    it('rejects anything else — wrong case, typos, non-string', () => {
      expect(isValidMode('Designer')).toBe(false);
      expect(isValidMode('asker')).toBe(false);
      expect(isValidMode(undefined)).toBe(false);
      expect(isValidMode(null)).toBe(false);
      expect(isValidMode(42)).toBe(false);
      expect(isValidMode('')).toBe(false);
    });
  });

  describe('AI_CHAT_MODES', () => {
    it('exposes the canonical mode list in stable order', () => {
      expect([...AI_CHAT_MODES]).toEqual(['designer', 'ask', 'review']);
    });
  });

  describe('isToolAllowedForMode', () => {
    it('Designer keeps every tool available', () => {
      ['createEntity', 'createRelationship', 'navigateTo', 'listEntities', 'getEntityDetails', 'listStereotypes']
        .forEach(t => expect(isToolAllowedForMode(t, 'designer')).toBe(true));
    });

    it('Ask drops creates, mutations, and navigation', () => {
      expect(isToolAllowedForMode('createEntity', 'ask')).toBe(false);
      expect(isToolAllowedForMode('createRelationship', 'ask')).toBe(false);
      expect(isToolAllowedForMode('navigateTo', 'ask')).toBe(false);
    });

    it('Ask keeps the read-only inspection tools', () => {
      expect(isToolAllowedForMode('listEntities', 'ask')).toBe(true);
      expect(isToolAllowedForMode('getEntityDetails', 'ask')).toBe(true);
      expect(isToolAllowedForMode('listStereotypes', 'ask')).toBe(true);
      expect(isToolAllowedForMode('listPackages', 'ask')).toBe(true);
    });

    it('Review uses the same allowlist as Ask', () => {
      // The two modes only differ in the system-prompt suffix; the
      // tool gate is identical so we can't accidentally let Review
      // mutate the model.
      ['createEntity', 'createRelationship', 'navigateTo'].forEach(t =>
        expect(isToolAllowedForMode(t, 'review')).toBe(false),
      );
      ['listEntities', 'getEntityDetails', 'listStereotypes', 'listPackages'].forEach(t =>
        expect(isToolAllowedForMode(t, 'review')).toBe(true),
      );
    });
  });

  describe('getModeSystemSuffix', () => {
    it('Designer gets no suffix (preserves pre-#55 prompt verbatim)', () => {
      expect(getModeSystemSuffix('designer')).toBe('');
    });

    it('Ask suffix mentions read-only and forbids writes', () => {
      const s = getModeSystemSuffix('ask');
      expect(s).toMatch(/Mode:\s*ASK/);
      expect(s).toMatch(/read-only/);
      expect(s.toLowerCase()).toContain('not available');
    });

    it('Review suffix names the mode and asks for grouped findings', () => {
      const s = getModeSystemSuffix('review');
      expect(s).toMatch(/Mode:\s*REVIEW/);
      expect(s).toMatch(/severity/);
      expect(s).toContain('listDocumentationChunks');
      expect(s).toContain('getDocumentationReviewCoverage');
      expect(s).toMatch(/coverage\.complete/);
    });
  });

  describe('filterToolsForMode', () => {
    const allTools = {
      createEntity: { __t: 'create' },
      createRelationship: { __t: 'create' },
      listEntities: { __t: 'read' },
      getEntityDetails: { __t: 'read' },
      listStereotypes: { __t: 'read' },
      navigateTo: { __t: 'navigate' },
    } as const;

    it('Designer returns the full toolset (no allocation drop)', () => {
      const out = filterToolsForMode(allTools, 'designer');
      expect(Object.keys(out).sort()).toEqual(Object.keys(allTools).sort());
    });

    it('Ask returns only the read-only tools', () => {
      const out = filterToolsForMode(allTools, 'ask');
      expect(Object.keys(out).sort()).toEqual(['getEntityDetails', 'listEntities', 'listStereotypes']);
    });

    it('Review returns the same read-only tools as Ask', () => {
      const askOut = filterToolsForMode(allTools, 'ask');
      const reviewOut = filterToolsForMode(allTools, 'review');
      expect(Object.keys(reviewOut).sort()).toEqual(Object.keys(askOut).sort());
    });

    it('preserves the original tool definitions verbatim (no rewrap)', () => {
      const out = filterToolsForMode(allTools, 'ask');
      expect(out.listEntities).toBe(allTools.listEntities);
    });
  });
});
