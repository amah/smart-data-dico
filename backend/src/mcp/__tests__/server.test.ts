import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer, MCP_TOOL_NAMES } from '../server.js';

describe('MCP server (#62)', () => {
  it('exposes the expected data-dictionary tools via tools/list', async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([...MCP_TOOL_NAMES].sort());
    } finally {
      await client.close();
      await server.close();
    }
  });
});
