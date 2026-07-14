import { getAgentTool } from '../../ai/agentToolRegistry.js';
import { registerDocumentationAgentTools } from '../agentTools.js';

describe('documentation agent tools', () => {
  beforeAll(() => registerDocumentationAgentTools());

  it.each([
    'listDocumentation', 'searchDocumentation', 'getDocumentation',
    'listDocumentationChunks', 'getDocumentationChunk',
    'getDocumentationReviewCoverage', 'getDocumentationForElement',
  ])('registers %s as read-only', (name) => {
    expect(getAgentTool(name)).toMatchObject({ name, category: 'read' });
  });

  it('is idempotent', () => {
    expect(() => registerDocumentationAgentTools()).not.toThrow();
  });
});
