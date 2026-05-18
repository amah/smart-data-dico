/**
 * Integration test for McpClientRegistry (#178).
 *
 * Stands up a trivial in-process MCP server using InMemoryTransport
 * (the same helper used by backend/src/mcp/__tests__/server.test.ts).
 * A thin test subclass injects the pre-wired client so we verify the
 * full callTool / listTools round-trip without spawning processes.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import {
  McpClientRegistry,
  McpConnection,
  McpToolDef,
  BUILTIN_TOOL_NAMES,
} from '../mcpClientRegistry.js';

// ---------------------------------------------------------------------------
// Mock persistence helpers so the tests don't read/write ~/.dico-app/
// ---------------------------------------------------------------------------
jest.mock('../../utils/appDir.js', () => ({
  getConfigSection: jest.fn(() => undefined),
  setConfigSection: jest.fn(),
}));
jest.mock('../../utils/logger.js', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import { getConfigSection, setConfigSection } from '../../utils/appDir.js';
const mockGetConfigSection = getConfigSection as jest.MockedFunction<typeof getConfigSection>;
const mockSetConfigSection = setConfigSection as jest.MockedFunction<typeof setConfigSection>;

// ---------------------------------------------------------------------------
// Test-only subclass that bypasses transport creation by injecting a
// pre-wired MCP Client. This lets us test listTools / callTool without
// spawning child processes.
// ---------------------------------------------------------------------------

class TestMcpClientRegistry extends McpClientRegistry {
  /** Inject a live client for a connection id (bypasses stdio/http open). */
  injectClient(id: string, client: Client): void {
    // Access the private map via type assertion — test-only.
    (this as unknown as { _live: Map<string, { client: Client; transport: null }> })
      ._live.set(id, { client, transport: null as never });
  }
}

// ---------------------------------------------------------------------------
// Build a trivial in-process MCP server
// ---------------------------------------------------------------------------

function buildTestMcpServer(): McpServer {
  const server = new McpServer({ name: 'test-server', version: '0.0.1' });

  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Echoes the input message back.',
      inputSchema: {
        message: z.string().describe('Message to echo'),
      },
    },
    async ({ message }: { message: string }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => ({
      content: [{ type: 'text', text: `echo: ${message}` }],
    }),
  );

  server.registerTool(
    'add',
    {
      title: 'Add',
      description: 'Adds two numbers.',
      inputSchema: {
        a: z.number().describe('First number'),
        b: z.number().describe('Second number'),
      },
    },
    async ({ a, b }: { a: number; b: number }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => ({
      content: [{ type: 'text', text: String(a + b) }],
    }),
  );

  return server;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createLinkedClientServer(): Promise<{
  client: Client;
  server: McpServer;
  cleanup: () => Promise<void>;
}> {
  const server = buildTestMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'registry-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    server,
    cleanup: async () => {
      await client.close().catch(() => { /* best-effort */ });
      await server.close().catch(() => { /* best-effort */ });
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpClientRegistry (#178)', () => {
  let registry: TestMcpClientRegistry;
  let cleanup: () => Promise<void>;
  let client: Client;

  const CONN: McpConnection = {
    id: 'test-server',
    label: 'Test Server',
    transport: 'stdio', // won't actually be used — we inject the client
    command: 'echo',    // placeholder
    enabled: true,
    trustLevel: 'auto',
  };

  beforeEach(async () => {
    registry = new TestMcpClientRegistry();
    mockGetConfigSection.mockReturnValue(undefined);
    mockSetConfigSection.mockClear();

    const linked = await createLinkedClientServer();
    client = linked.client;
    cleanup = linked.cleanup;

    // Inject the pre-wired client
    registry.injectClient(CONN.id, client);
  });

  afterEach(async () => {
    await registry.closeAll();
    await cleanup();
    jest.clearAllMocks();
  });

  // --- persistence ---

  describe('getConnections / saveConnections', () => {
    it('returns empty array when no config section exists', () => {
      mockGetConfigSection.mockReturnValue(undefined);
      expect(registry.getConnections()).toEqual([]);
    });

    it('returns stored connections', () => {
      mockGetConfigSection.mockReturnValue({ connections: [CONN] });
      expect(registry.getConnections()).toEqual([CONN]);
    });

    it('upsertConnection adds a new connection', () => {
      mockGetConfigSection.mockReturnValue({ connections: [] });
      registry.upsertConnection(CONN);
      expect(mockSetConfigSection).toHaveBeenCalledWith('mcp', {
        connections: [CONN],
      });
    });

    it('upsertConnection updates an existing connection', () => {
      const updated = { ...CONN, label: 'Updated' };
      mockGetConfigSection.mockReturnValue({ connections: [CONN] });
      registry.upsertConnection(updated);
      expect(mockSetConfigSection).toHaveBeenCalledWith('mcp', {
        connections: [updated],
      });
    });

    it('deleteConnection removes the connection', () => {
      mockGetConfigSection.mockReturnValue({ connections: [CONN] });
      const deleted = registry.deleteConnection(CONN.id);
      expect(deleted).toBe(true);
      expect(mockSetConfigSection).toHaveBeenCalledWith('mcp', {
        connections: [],
      });
    });

    it('deleteConnection returns false for unknown id', () => {
      mockGetConfigSection.mockReturnValue({ connections: [] });
      expect(registry.deleteConnection('does-not-exist')).toBe(false);
    });
  });

  // --- validation ---

  describe('validateConnection', () => {
    it('passes a valid stdio connection', () => {
      expect(registry.validateConnection(CONN)).toEqual([]);
    });

    it('rejects empty id', () => {
      const errors = registry.validateConnection({ ...CONN, id: '' });
      expect(errors).toContain('id must not be empty');
    });

    it('rejects id with a dot', () => {
      const errors = registry.validateConnection({ ...CONN, id: 'a.b' });
      expect(errors).toContain(
        'id must not contain a dot (dots are reserved for tool name namespacing)',
      );
    });

    it('rejects id clashing with a built-in tool name', () => {
      for (const name of BUILTIN_TOOL_NAMES) {
        const errors = registry.validateConnection({ ...CONN, id: name });
        expect(errors).toContain(`id "${name}" clashes with a built-in tool name`);
      }
    });

    it('rejects empty label', () => {
      const errors = registry.validateConnection({ ...CONN, label: '' });
      expect(errors).toContain('label must not be empty');
    });

    it('rejects invalid transport', () => {
      const errors = registry.validateConnection({ ...CONN, transport: 'ws' as never });
      expect(errors).toContain('transport must be "stdio" or "http"');
    });

    it('rejects stdio without command', () => {
      const errors = registry.validateConnection({ ...CONN, command: undefined });
      expect(errors).toContain('command is required for stdio transport');
    });

    it('rejects http without url', () => {
      const errors = registry.validateConnection({
        ...CONN,
        transport: 'http',
        command: undefined,
        url: undefined,
      });
      expect(errors).toContain('url is required for http transport');
    });

    it('passes a valid http connection', () => {
      const errors = registry.validateConnection({
        id: 'remote-svc',
        label: 'Remote',
        transport: 'http',
        url: 'https://example.com/mcp',
        enabled: true,
        trustLevel: 'review',
      });
      expect(errors).toEqual([]);
    });
  });

  // --- tool listing ---

  describe('listToolsForConnection', () => {
    it('returns namespaced tools from the in-process server', async () => {
      mockGetConfigSection.mockReturnValue({ connections: [CONN] });

      const tools = await registry.listToolsForConnection(CONN);

      expect(tools).toHaveLength(2);
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(['test-server.add', 'test-server.echo']);

      const echoTool = tools.find((t) => t.rawName === 'echo')!;
      expect(echoTool.connectionId).toBe('test-server');
      expect(echoTool.trustLevel).toBe('auto');
      expect(echoTool.description).toBeTruthy();
    });

    it('returns empty array for blocked connection', async () => {
      const blocked: McpConnection = { ...CONN, trustLevel: 'block' };
      const tools = await registry.listToolsForConnection(blocked);
      expect(tools).toEqual([]);
    });

    it('returns empty array for disabled connection', async () => {
      const disabled: McpConnection = { ...CONN, enabled: false };
      const tools = await registry.listToolsForConnection(disabled);
      expect(tools).toEqual([]);
    });
  });

  describe('listAllTools', () => {
    it('aggregates tools from all enabled, non-blocked connections', async () => {
      const conn2: McpConnection = { ...CONN, id: 'conn2', label: 'Conn2' };
      mockGetConfigSection.mockReturnValue({ connections: [CONN, conn2] });

      // Inject the same client for conn2 so both resolve
      registry.injectClient('conn2', client);

      const tools = await registry.listAllTools();
      const names = tools.map((t: McpToolDef) => t.name).sort();
      expect(names).toEqual([
        'conn2.add',
        'conn2.echo',
        'test-server.add',
        'test-server.echo',
      ]);
    });

    it('skips connections that error without failing the whole batch', async () => {
      const badConn: McpConnection = {
        id: 'bad-conn',
        label: 'Bad',
        transport: 'http',
        url: 'http://127.0.0.1:1', // unreachable
        enabled: true,
        trustLevel: 'review',
      };
      mockGetConfigSection.mockReturnValue({ connections: [CONN, badConn] });

      const tools = await registry.listAllTools();
      // At least the good connection's tools come back
      expect(tools.some((t: McpToolDef) => t.connectionId === 'test-server')).toBe(true);
      // Bad connection silently produces nothing
      expect(tools.some((t: McpToolDef) => t.connectionId === 'bad-conn')).toBe(false);
    });
  });

  // --- tool invocation ---

  describe('callTool', () => {
    beforeEach(() => {
      mockGetConfigSection.mockReturnValue({ connections: [CONN] });
    });

    it('calls a tool and returns { success: true, content }', async () => {
      const result = await registry.callTool('test-server.echo', { message: 'hello' });
      expect(result.success).toBe(true);
      if (result.success) {
        const content = result.content as Array<{ type: string; text: string }>;
        expect(Array.isArray(content)).toBe(true);
        const text = content.map((c) => c.text).join('');
        expect(text).toBe('echo: hello');
      }
    });

    it('calls the add tool and returns the correct sum', async () => {
      const result = await registry.callTool('test-server.add', { a: 3, b: 7 });
      expect(result.success).toBe(true);
      if (result.success) {
        const content = result.content as Array<{ type: string; text: string }>;
        const text = content.map((c) => c.text).join('');
        expect(text).toBe('10');
      }
    });

    it('returns error for invalid namespaced name (no dot)', async () => {
      const result = await registry.callTool('nodot', {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('no dot');
      }
    });

    it('returns error for unknown connection', async () => {
      const result = await registry.callTool('unknown-conn.someTool', {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('not found');
      }
    });

    it('returns error for disabled connection', async () => {
      const disabled: McpConnection = { ...CONN, enabled: false };
      mockGetConfigSection.mockReturnValue({ connections: [disabled] });
      const result = await registry.callTool('test-server.echo', { message: 'hi' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('disabled');
      }
    });

    it('returns error for blocked connection', async () => {
      const blocked: McpConnection = { ...CONN, trustLevel: 'block' };
      mockGetConfigSection.mockReturnValue({ connections: [blocked] });
      const result = await registry.callTool('test-server.echo', { message: 'hi' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('blocked');
      }
    });

    it('times out and returns error when the call exceeds the timeout', async () => {
      // Use a very short timeout (1ms) to trigger reliably
      const shortTimeout: McpConnection = { ...CONN, timeout: 1 };
      mockGetConfigSection.mockReturnValue({ connections: [shortTimeout] });

      // Create a new frozen client using a server that delays responses
      const slowServer = new McpServer({ name: 'slow', version: '0.0.0' });
      slowServer.registerTool(
        'slow',
        { title: 'Slow', description: 'Delays', inputSchema: {} },
        async () => {
          await new Promise((r) => setTimeout(r, 500));
          return { content: [{ type: 'text' as const, text: 'done' }] };
        },
      );
      const [ct, st] = InMemoryTransport.createLinkedPair();
      const slowClient = new Client({ name: 'slow-client', version: '0.0.0' });
      await Promise.all([slowServer.connect(st), slowClient.connect(ct)]);

      registry.injectClient('test-server', slowClient);

      const result = await registry.callTool('test-server.slow', {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toMatch(/[Tt]imeout/);
      }

      await slowClient.close().catch(() => { /* ok */ });
      await slowServer.close().catch(() => { /* ok */ });
    });
  });

  // --- ENV interpolation ---

  describe('BUILTIN_TOOL_NAMES', () => {
    it('contains the expected built-in names', () => {
      expect(BUILTIN_TOOL_NAMES.has('createEntity')).toBe(true);
      expect(BUILTIN_TOOL_NAMES.has('listEntities')).toBe(true);
      expect(BUILTIN_TOOL_NAMES.has('navigateTo')).toBe(true);
    });
  });
});
