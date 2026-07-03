/**
 * Element-style agent tools are registered into the shared agent-tool registry
 * as `modify` tools with the expected schemas, so the AI chat can set styles.
 */
import { registerElementStyleAgentTools } from '../agentTools.js';
import { getAgentTool } from '../../ai/agentToolRegistry.js';

describe('registerElementStyleAgentTools', () => {
  beforeAll(() => registerElementStyleAgentTools());

  it.each(['defineElementStyle', 'addStyleRule', 'setEntityStyle'])('registers %s as a modify tool', (name) => {
    const tool = getAgentTool(name);
    expect(tool).toBeDefined();
    expect(tool!.category).toBe('modify');
    expect(tool!.jsonSchema).toHaveProperty('properties');
    expect(tool!.inputSchema).toBeDefined();
  });

  it('is idempotent (safe to call twice)', () => {
    expect(() => { registerElementStyleAgentTools(); registerElementStyleAgentTools(); }).not.toThrow();
  });

  it('defineElementStyle requires a name; addStyleRule requires match/pattern/style', () => {
    expect((getAgentTool('defineElementStyle')!.jsonSchema as { required: string[] }).required).toEqual(['name']);
    expect((getAgentTool('addStyleRule')!.jsonSchema as { required: string[] }).required).toEqual(['match', 'pattern', 'style']);
  });
});
