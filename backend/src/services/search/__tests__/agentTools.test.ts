/**
 * searchModel agent tool (#search-index) — exercises the tool's execute glue
 * against a live in-memory index: arg mapping, kind filter, result shaping, and
 * the graceful "index unavailable" branch.
 */
import { registerSearchAgentTools } from '../agentTools.js';
import { getAgentTool } from '../../ai/agentToolRegistry.js';
import { SearchIndex } from '../searchIndex.js';
import { __setSearchIndexForTest, resetSearchIndexForTest } from '../searchIndexService.js';
import type { Package } from '../../../models/Dictionary.js';
import type { AgentToolContext } from '../../ai/agentToolRegistry.js';

const ctx: AgentToolContext = { dataDir: '/tmp/x' };

const ordering = {
  id: 'ordering', name: 'ordering', description: 'orders', subPackages: [], relationships: [],
  entities: [
    { uuid: 'u1', name: 'Payment', description: 'Payment transaction for an order', attributes: [
      { uuid: 'a1', name: 'iban', description: 'international bank account number', type: 'string', required: true },
    ], metadata: [] },
    { uuid: 'u2', name: 'Order', description: 'Customer order', attributes: [], metadata: [] },
  ],
} as unknown as Package;

describe('searchModel agent tool', () => {
  beforeAll(() => registerSearchAgentTools());
  afterEach(() => resetSearchIndexForTest());

  const tool = () => getAgentTool('searchModel')!;

  it('is registered as a read-only tool with the expected schema', () => {
    const t = tool();
    expect(t).toBeDefined();
    expect(t.category).toBe('read');
    expect((t.jsonSchema as { required: string[] }).required).toContain('query');
  });

  it('returns ranked hits for a fuzzy query, incl. an attribute found by name', async () => {
    const idx = new SearchIndex(':memory:');
    await idx.open();
    if (!idx.isReady()) { console.warn('node:sqlite unavailable — skipping'); return; }
    idx.rebuildFrom([ordering]);
    __setSearchIndexForTest(idx);

    const res = await tool().execute({ query: 'iban' }, ctx) as { success: boolean; count: number; results: Array<{ kind: string; name: string; entity?: string }> };
    expect(res.success).toBe(true);
    expect(res.count).toBeGreaterThan(0);
    const attr = res.results.find((r) => r.name === 'iban');
    expect(attr?.kind).toBe('attribute');
    expect(attr?.entity).toBe('Payment');
  });

  it('honours the kind filter', async () => {
    const idx = new SearchIndex(':memory:');
    await idx.open();
    if (!idx.isReady()) return;
    idx.rebuildFrom([ordering]);
    __setSearchIndexForTest(idx);

    const res = await tool().execute({ query: 'payment', kind: 'entity' }, ctx) as { results: Array<{ kind: string }> };
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results.every((r) => r.kind === 'entity')).toBe(true);
  });

  it('degrades gracefully when the index is unavailable', async () => {
    __setSearchIndexForTest(null);
    const res = await tool().execute({ query: 'anything' }, ctx) as { success: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not available/i);
  });
});
