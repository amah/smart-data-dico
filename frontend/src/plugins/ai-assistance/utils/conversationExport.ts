/**
 * Export an AI agent conversation as readable Markdown (#ai-export).
 *
 * Format (agreed proposal — "readable + folded tools"):
 *   - `# Title` + a metadata table (exported/created/mode/messages/usage).
 *   - One `### 👤 User` / `### 🤖 Assistant` section per turn, full text.
 *   - Each turn's tool calls fold into a `<details>` block: a one-line result
 *     summary list, then each call's input/output as JSON (truncated if huge).
 *   - Condensed / cancelled turns are annotated inline.
 *
 * `conversationToMarkdown` is pure (no DOM) so it's unit-tested directly; the
 * panel wraps it with a Blob download.
 */
import type { Conversation, ConversationChatMessage } from '../services/AIService';

interface ToolCallLike {
  name?: string;
  input?: unknown;
  output?: unknown;
  status?: string;
}

const MAX_JSON = 4000; // cap a single input/output block so exports stay readable

/** 15230 → "15.2k". */
function compact(n?: number): string {
  if (n == null) return '?';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** ISO-ish "2026-07-06 17:05 UTC" (or "—"). */
function fmtDate(iso?: string, now?: Date): string {
  const d = iso ? new Date(iso) : now;
  if (!d || isNaN(d.getTime())) return '—';
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function safeJson(v: unknown): string {
  let s: string;
  try { s = JSON.stringify(v ?? null, null, 2); } catch { s = String(v); }
  if (s.length > MAX_JSON) s = `${s.slice(0, MAX_JSON)}\n… (truncated)`;
  return s;
}

/** One-line result summary for a tool call. */
function toolResult(t: ToolCallLike): string {
  if (t.status === 'undone') return '↩ undone';
  if (t.status === 'cancelled') return '— cancelled';
  const o = t.output as Record<string, unknown> | undefined;
  if (o && typeof o === 'object') {
    if (o.success === false || o.error) return `✗ ${String(o.error ?? 'failed')}`;
    const data = (o.data as Record<string, unknown>) || o;
    const name = data.name ?? data.entity ?? o.name ?? o.entity;
    return name ? `→ ✓ \`${String(name)}\`` : '→ ✓';
  }
  return t.output !== undefined ? '→ ✓' : '';
}

/** A short kebab filename for the conversation's .md export. */
export function conversationFilename(conv: Pick<Conversation, 'title'>, now = new Date()): string {
  const slug = (conv.title || 'ai-conversation')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ai-conversation';
  return `${slug}-${now.toISOString().slice(0, 10)}.md`;
}

export function conversationToMarkdown(conv: Conversation, now = new Date()): string {
  const out: string[] = [];
  out.push(`# ${conv.title?.trim() || 'AI conversation'}`, '');

  // Metadata table.
  const rows: Array<[string, string]> = [['Exported', fmtDate(undefined, now)]];
  if (conv.createdAt) rows.push(['Created', fmtDate(conv.createdAt)]);
  if (conv.mode) rows.push(['Mode', conv.mode]);
  rows.push(['Messages', String(conv.messages?.length ?? 0)]);
  if (conv.usage) {
    const u = conv.usage;
    const cost = typeof u.totalCost === 'number' ? ` (~$${u.totalCost.toFixed(2)})` : '';
    rows.push(['Usage', `${compact(u.inputTokens)} in / ${compact(u.outputTokens)} out${cost}`]);
  }
  out.push('| Field | |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${v} |`), '', '---', '');

  for (const m of (conv.messages ?? []) as ConversationChatMessage[]) {
    const who = m.role === 'user' ? '👤 User' : '🤖 Assistant';
    const ts = m.timestamp ? ` · ${fmtDate(m.timestamp)}` : '';
    out.push(`### ${who}${ts}`, '');
    if (m.condensed) out.push(`> _${m.condensed.count} earlier message${m.condensed.count === 1 ? '' : 's'} condensed._`, '');
    out.push((m.text || '').trim() || '_(no text)_', '');
    if (m.cancelled) out.push('> _(cancelled)_', '');

    const tools = (Array.isArray(m.toolCalls) ? m.toolCalls : []) as ToolCallLike[];
    if (tools.length) {
      out.push(`<details><summary>🔧 ${tools.length} tool${tools.length === 1 ? '' : 's'}</summary>`, '');
      for (const t of tools) out.push(`- **${t.name || 'tool'}** ${toolResult(t)}`.trimEnd());
      out.push('');
      for (const t of tools) {
        out.push(`**${t.name || 'tool'}** · input`, '```json', safeJson(t.input), '```');
        if (t.output !== undefined) out.push(`**${t.name || 'tool'}** · output`, '```json', safeJson(t.output), '```');
      }
      out.push('</details>', '');
    }
    out.push('---', '');
  }
  return out.join('\n');
}
