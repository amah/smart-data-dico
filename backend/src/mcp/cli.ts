#!/usr/bin/env node
/**
 * MCP server stdio entrypoint for the `npm run mcp` script and the
 * `bin/dico-mcp.js` launcher. The library logic lives in `./server.ts`;
 * this file only exists to invoke it as a script (kept separate from the
 * library so Jest can compile `server.ts` to CJS for tests).
 */
import { startStdioServer } from './server.js';

startStdioServer().catch((err) => {
  process.stderr.write(`[dico-mcp] fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
