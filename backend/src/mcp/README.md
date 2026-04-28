# Smart Data Dictionary MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
the in-app data-dictionary operations (entity CRUD, listing, relationships,
stereotypes) so external clients — Claude Desktop, Cursor, Roo Code, Claude
Code, etc. — can call them directly against your project files.

The server reuses the same backend services as the running web app and the
in-app AI chat. It is a separate **transport** for the same operations, not
a duplicate code path.

## Tools

| Tool | Purpose |
| --- | --- |
| `listPackages` | List all packages in the project. |
| `listEntities` | List entities in a package (or list all packages if `packageName` is omitted). |
| `getEntityDetails` | Read the full schema for an entity — attributes, stereotype, status. |
| `createEntity` | Create a new entity with attributes. Creates the package directory if missing. |
| `createRelationship` | Create a relationship between two existing entities in the same package. |
| `listStereotypes` | List the project's stereotypes (metadata schemas) and their fields. |

## Launch

The server reads YAML files from the same directory the rest of the backend
uses, controlled by the `DATA_DIR` env var or the `--data-dir` CLI flag.

```bash
# from the backend folder, against a specific project
DATA_DIR=/path/to/your/project npm run mcp

# or via the bin script (resolves --data-dir like the main CLI)
node ../bin/dico-mcp.js --data-dir /path/to/your/project
```

The process speaks JSON-RPC on stdio — it stays attached to its parent and
exits when the client disconnects. All log output is redirected to stderr so
it does not corrupt the JSON-RPC framing on stdout.

## Register with Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) and add:

```json
{
  "mcpServers": {
    "smart-data-dico": {
      "command": "node",
      "args": [
        "/absolute/path/to/smart-data-dico/bin/dico-mcp.js",
        "--data-dir",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

## Register with Cursor

Add to `.cursor/mcp.json` in your project (or the global `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "smart-data-dico": {
      "command": "node",
      "args": [
        "/absolute/path/to/smart-data-dico/bin/dico-mcp.js",
        "--data-dir",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

## Register with Roo Code

Add to `.roo/mcp.json`:

```json
{
  "mcpServers": {
    "smart-data-dico": {
      "command": "node",
      "args": [
        "/absolute/path/to/smart-data-dico/bin/dico-mcp.js",
        "--data-dir",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

## Notes

- The MCP server does **not** start the HTTP backend; it talks to the same
  YAML files directly via the existing services. You can run the web UI and
  the MCP server side by side against the same project.
- Auto-commit (Git) honours the same `GIT_AUTO_COMMIT` env var as the web
  backend.
