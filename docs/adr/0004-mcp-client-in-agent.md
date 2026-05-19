# ADR-0004: In-app AI agent consumes external MCP servers as tool sources

Status: Accepted (2026-05-19)

## Context

The in-app AI agent in `backend/src/controllers/aiController.ts` had a hand-rolled
tool registry (`createEntity`, `createRelationship`, `listEntities`,
`getEntityDetails`, `listStereotypes`, `navigateTo`, `listRoutes`). Every new
capability required a backend code change in five touchpoints per tool — the AI
SDK tool def, the direct-chat tool def, the `/api/ai/tools` metadata, the system
prompt, and the tool-category map.

Meanwhile the project already speaks MCP in the *opposite* direction:
`backend/src/mcp/server.ts` exposes our domain operations to external clients
(Claude Desktop, Cursor, Roo Code) via `@modelcontextprotocol/sdk`, which is
already a backend dependency at `^1.29.0`. Issue #178 observed that the protocol
that lets external assistants reach our domain is the same protocol that would
let our in-app assistant reach OTHER systems' domains — Slack, GitHub, Linear,
internal data catalogs.

The goal: let the in-app AI agent connect to external MCP servers and surface
their tools alongside the built-in tools, with the same per-category
auto-approve / review policy. New capabilities become a configuration change,
not a code change.

## Decision

Add a parallel MCP client registry that lives next to the hand-rolled tool
registry. Merge the two only at chat-request build time.

### Two registries, never one

The built-in tool registry stays hardcoded in `aiController.ts`. MCP tools live
in a separate `mcpClientRegistry` singleton (`backend/src/services/mcpClientRegistry.ts`).
The two are merged only when each chat request builds its tool list — at three
sites that already exist for the in-house tools:

- the AI SDK tool registration (`aiController.ts` streamText path),
- the direct-chat tool defs and executor (Anthropic native path),
- the `/api/ai/tools` metadata endpoint consumed by the Settings UI.

Not bundling the two registries was a deliberate trade-off. Migrating the
hardcoded tools into the registry shape would have shipped a refactor with the
feature; the registry's surface is also slightly different (it carries
`source`, `connectionId`, `trustLevel`, and uses JSON-schema `inputSchema`
rather than the Vercel-AI-SDK `parameters` array). Keeping them separate ships
the feature without breaking either path.

### Tool name namespacing

MCP tool names are exposed to the agent as `<connectionId>.<toolName>`, e.g.
`slack.sendMessage`. The dot separator is safe under both the AI SDK's and the
MCP SDK's input-name validators and matches MCP community convention. Built-in
tool names have no dot, and `mcpClientRegistry.validateConnection()` rejects a
connection id containing a dot or matching a built-in tool name.

### Persistence: same store, same trust boundary

Connection definitions persist in `~/.dico-app/dico-app.json` under a new
`mcp` section, via the existing `getConfigSection` / `setConfigSection` helpers
from `backend/src/utils/appDir.ts`. That file already holds the AI provider's
`apiKey` and is the right neighbour for MCP credentials — same threat model,
same mitigations:

- `setConfigSection` writes via atomic temp + rename.
- The file lands with mode `0600`.
- `ensureRestrictivePerms` self-heals: re-chmods to `0600` on every read if the
  file is found widened, and emits a one-shot logger warning.

No new persistence machinery was designed. Connections written by the registry
inherit every secrets-handling mitigation already applied to `apiKey`.

### Secrets handling on the wire

MCP `env` and `headers` records may contain bearer tokens. The Settings UI must
be able to show that a secret *is* saved without ever rendering the secret
itself. Two complementary mechanisms:

**1. Mask sentinel.** The `GET /api/ai/mcp/connections` route returns
`••••••••` in place of any stored `env` / `header` value. The mask string is
literal U+2022 BULLET × 8 — distinct enough that it never collides with a real
secret. `${VAR}` placeholders pass through unmasked because they are pointers
to `process.env`, not secrets; the user has explicitly opted out of persisting
a value there.

**2. Masked-edit guard.** The `POST /api/ai/mcp/connections` route applies a
per-field merge against the stored record: any value the client sends back as
the mask sentinel is replaced with the persisted value from the existing
connection record. New connections (no prior record to merge from) drop masked
values silently — there is nothing to preserve from. The route echoes back the
masked shape so even the success response never leaks a secret the request
just wrote.

This is a slightly nicer affordance than the AI provider `apiKey` field (which
always requires re-entry on save). The difference is that `apiKey` is a single
field, while MCP `env` / `headers` are arbitrary key-value maps with many
secret-bearing fields per connection. Forcing re-entry on every save of every
field would be hostile.

**`${ENV_VAR}` interpolation** is supported in `command`, `env.*`, `headers.*`,
and `url` values as an opt-in convenience for users who prefer not to persist
tokens at all. Resolved at connection-open time via
`mcpClientRegistry.interpolateEnv()`; never written back.

### Trust policy: per-connection, not per-tool

`TOOL_CATEGORY_MAP` in `aiController.ts` hardcodes each built-in tool into a
category (`read` / `navigate` / `create` / `modify` / `delete`). MCP tools have
no category metadata of their own. v1 keeps the policy surface small:

- Each connection has a `trustLevel: 'auto' | 'review' | 'block'`.
- `block` — connection's tools are never added to the registry.
- `review` — every call from this connection prompts the user, regardless of
  the per-category default.
- `auto` — the connection's tools default to the `modify` category, so they
  fall under the existing default-policy `review` for `modify` unless the user
  has raised `modify` to `auto` in `aiAutoApprovePolicy`.

Per-tool granularity is deferred. If real workflows need it, the per-connection
knob already covers the 80% case ("trust this whole server" or "don't").

### Transports

The registry supports both transports defined by the MCP spec:

- **stdio** — for local processes (e.g. a Slack MCP launched as a subprocess
  via `npx`). Mirrors the shape of our own `mcp/cli.ts`, reversed.
- **streamable-http** — for remote MCP servers behind HTTPS endpoints.

A per-call `AbortController` with a 10-second default timeout (configurable
per connection via `connection.timeout`) caps tool latency. Live connections
are cached lazily; a single transient transport error triggers one
reconnect-and-retry before propagating.

### Frontend attribution

The Settings UI uses `ui/` primitives + design tokens, not DaisyUI — per memory
`feedback_design_system`. Tool-call source attribution in the chat panel reads
`source` and `connectionLabel` from the same `/api/ai/tools` manifest used to
build the catalog tab, so the chat card can render a `from <label>` pill the
moment a `tool-input-start` event arrives.

## Consequences

### Positive

- New capabilities for the in-app agent become a configuration change. A user
  who already has the `@modelcontextprotocol/server-slack` package on their
  system can add a Slack server through Settings without touching code.
- Both registries stay tractable: the built-in registry remains the place
  where domain-specific tools live (with the structured create/modify/delete
  category lattice); the MCP registry is the catch-all for external sources.
- Secrets-handling mitigations compose cleanly with the existing `apiKey`
  story. There is no new place where secrets live; there is no new ceremony
  to apply the existing `0600` / atomic-write / self-heal protections.
- The frontend can attribute tool calls to their source without an extra
  round-trip — `connectionLabel` is enriched into the manifest on the backend.

### Negative / Trade-offs

- **Two registries, two code paths to merge.** The merge happens at three
  sites in `aiController.ts`. Easy to forget one. The acceptance tests for
  slice 1 covered all three paths.
- **Tool-call loop runaway** — an MCP tool whose output prompts more tool
  calls can chain indefinitely. Bounded by the existing `stepCountIs(20)` on
  the streamText path and `stepCountIs(3)` on the direct-chat path.
- **MCP server hang / slow response** blocks tool-call latency. The 10s
  `AbortController` timeout is a hard cap but the user still waits up to that
  long. A pre-call `listTools()` probe (`POST .../test`) lets the user spot a
  flaky server in Settings before it hits a real chat turn.
- **Untrusted MCP server output** that the agent then acts on. v1 treats MCP
  tool output as text + JSON only (never rendered as HTML). The
  `trustLevel: 'review'` connection-level setting is the user's escape hatch
  for a server whose outputs they don't yet trust.
- **Single shared registry** — the singleton is process-global. When
  multi-user (#169) lands, connections need to become per-user. Until then,
  single-user-per-backend is the explicit model and matches the rest of the
  app's auth assumptions.

### Deferred to follow-up

- **Per-tool override granularity.** If real usage shows that a single
  connection mixes safe-to-auto-approve tools with risky ones, expose a
  per-tool category override. v1 design keeps the per-connection knob.
- **Hot-reloading connections without backend restart** beyond the
  "kill+reconnect that one connection on edit" behavior in
  `mcpClientRegistry.upsertConnection`.
- **Keychain-backed secrets.** The current `0600`-protected JSON file is a
  reasonable v1 trust boundary. Moving to the OS keychain (Keychain Access /
  libsecret / Credential Manager) is a defensible follow-up if the file's
  threat model proves insufficient.
- **WebSocket MCP transport** is not yet standardized in the spec; the
  registry supports the two stable transports.
- **Bidirectional sampling** (MCP servers calling back into the agent's LLM)
  is not a v1 use case.

## References

- Issue #178 — the originating ticket
- ADR-0001 — plain Express, no server-side microkernel (justifies why
  `mcpClientRegistry` is a singleton, not a DI-registered service)
- `backend/src/services/mcpClientRegistry.ts` — the registry
- `backend/src/routes/ai/mcp.routes.ts` — CRUD + `test` + masked-edit guard
- `frontend/src/components/McpServersSection.tsx` — Settings UI
- `frontend/src/plugins/ai-assistance/components/AIChatPanel.tsx` — chat-card
  source attribution (slice 3)
