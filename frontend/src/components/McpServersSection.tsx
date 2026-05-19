/**
 * McpServersSection (#178 slice 2).
 *
 * Settings-page section for managing MCP server connections that the
 * in-app AI agent uses as additional tool sources. Renders a row per
 * stored connection plus an "Add server" affordance; uses Modal +
 * Field + Input + Button + Chip + EmptyState from `components/ui/`
 * so the form lives on design tokens, not DaisyUI classes — per
 * memory `feedback_design_system`.
 *
 * Secrets handling:
 *   - The backend returns `••••••••` in place of any persisted env or
 *     header value (see `MCP_SECRET_MASK`). The form pre-fills those
 *     masks; if the user doesn't touch them, they round-trip back
 *     unchanged and the backend substitutes the real value at save
 *     time. Cleared / edited fields are sent as-typed.
 */

import { useEffect, useState, useCallback } from 'react';
import Button from './ui/Button';
import Input from './ui/Input';
import { Field } from './ui/Field';
import Chip, { type ChipTone } from './ui/Chip';
import Modal from './ui/Modal';
import EmptyState from './ui/EmptyState';
import {
  mcpService,
  MCP_SECRET_MASK,
  type McpConnection,
  type McpTestResult,
} from '../plugins/ai-assistance/services/McpService';

// ---------------------------------------------------------------------------
// Form-state shape — separate from `McpConnection` so unsaved string
// values for `args` (textarea) and the env/header KV list (array of
// pairs) don't bleed into the persisted shape until the user hits
// Save.
// ---------------------------------------------------------------------------

interface KvPair { key: string; value: string }

interface FormState {
  id: string;
  label: string;
  transport: 'stdio' | 'http';
  command: string;
  argsText: string;        // newline-separated, one arg per line
  env: KvPair[];
  url: string;
  headers: KvPair[];
  enabled: boolean;
  trustLevel: 'auto' | 'review' | 'block';
  timeout: string;          // string so the user can clear the field
}

const EMPTY_FORM: FormState = {
  id: '',
  label: '',
  transport: 'stdio',
  command: '',
  argsText: '',
  env: [],
  url: '',
  headers: [],
  enabled: true,
  trustLevel: 'review',
  timeout: '',
};

function recordToPairs(record: Record<string, string> | undefined): KvPair[] {
  if (!record) return [];
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

function pairsToRecord(pairs: KvPair[]): Record<string, string> | undefined {
  const trimmed = pairs.filter((p) => p.key.trim() !== '');
  if (trimmed.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const p of trimmed) out[p.key] = p.value;
  return out;
}

function connectionToForm(conn: McpConnection): FormState {
  return {
    id: conn.id,
    label: conn.label,
    transport: conn.transport,
    command: conn.command ?? '',
    argsText: (conn.args ?? []).join('\n'),
    env: recordToPairs(conn.env),
    url: conn.url ?? '',
    headers: recordToPairs(conn.headers),
    enabled: conn.enabled,
    trustLevel: conn.trustLevel,
    timeout: conn.timeout != null ? String(conn.timeout) : '',
  };
}

function formToConnection(form: FormState): McpConnection {
  const args = form.argsText
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const timeout = form.timeout.trim() !== '' ? Number(form.timeout) : undefined;
  return {
    id: form.id.trim(),
    label: form.label.trim(),
    transport: form.transport,
    enabled: form.enabled,
    trustLevel: form.trustLevel,
    ...(form.transport === 'stdio'
      ? {
          command: form.command,
          args: args.length > 0 ? args : undefined,
          env: pairsToRecord(form.env),
        }
      : {
          url: form.url,
          headers: pairsToRecord(form.headers),
        }),
    ...(timeout && !Number.isNaN(timeout) ? { timeout } : {}),
  };
}

const TRUST_TONE: Record<McpConnection['trustLevel'], ChipTone> = {
  auto: 'success',
  review: 'warning',
  block: 'danger',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface McpServersSectionProps {
  /**
   * Inject a custom service (tests). Defaults to the module-level
   * `mcpService` singleton.
   */
  service?: typeof mcpService;
}

const McpServersSection = ({ service = mcpService }: McpServersSectionProps) => {
  const [connections, setConnections] = useState<McpConnection[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');

  const [editing, setEditing] = useState<{ mode: 'add' } | { mode: 'edit'; id: string } | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [testResults, setTestResults] = useState<Record<string, McpTestResult | 'pending'>>({});

  const refresh = useCallback(async () => {
    setLoadState('loading');
    try {
      const list = await service.list();
      setConnections(list);
      setLoadState('loaded');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setLoadState('error');
    }
  }, [service]);

  useEffect(() => { refresh(); }, [refresh]);

  // --- Form helpers ------------------------------------------------------

  const startAdd = () => {
    setEditing({ mode: 'add' });
    setForm(EMPTY_FORM);
    setFormErrors([]);
  };

  const startEdit = (conn: McpConnection) => {
    setEditing({ mode: 'edit', id: conn.id });
    setForm(connectionToForm(conn));
    setFormErrors([]);
  };

  const cancel = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErrors([]);
  };

  const handleSave = async () => {
    setSaving(true);
    setFormErrors([]);
    try {
      const conn = formToConnection(form);
      await service.upsert(conn);
      await refresh();
      cancel();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The upsert endpoint returns 400 with `{ errors: [...] }` on
      // validation failure; surface those individually so the user
      // knows what to fix.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fieldErrors = (err as any)?.response?.data?.errors as string[] | undefined;
      setFormErrors(fieldErrors && fieldErrors.length > 0 ? fieldErrors : [message]);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(`Delete MCP connection "${id}"?`)) return;
    try {
      await service.remove(id);
      await refresh();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTest = async (id: string) => {
    setTestResults((prev) => ({ ...prev, [id]: 'pending' }));
    const result = await service.test(id).catch((err): McpTestResult => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }));
    setTestResults((prev) => ({ ...prev, [id]: result }));
  };

  const handleToggleEnabled = async (conn: McpConnection) => {
    try {
      // Round-trip the masked env/headers as-is; the backend's
      // masked-edit guard substitutes real values at save time.
      await service.upsert({ ...conn, enabled: !conn.enabled });
      await refresh();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };

  // --- Render ------------------------------------------------------------

  return (
    <div data-testid="mcp-servers-section" style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}>
          MCP servers
        </h3>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          External tool sources the AI agent can call alongside its built-ins.
        </span>
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="primary" icon="plus" onClick={startAdd} data-testid="mcp-add-button">
          Add server
        </Button>
      </div>

      {loadState === 'loading' && (
        <EmptyState kind="loading" message="Loading MCP connections…" />
      )}
      {loadState === 'error' && (
        <EmptyState
          kind="error"
          title="Couldn't load MCP connections"
          message={loadError}
          action={{ label: 'Retry', onClick: refresh }}
        />
      )}
      {loadState === 'loaded' && connections.length === 0 && (
        <EmptyState
          kind="empty"
          title="No MCP servers yet"
          message="Add an external server to extend the AI agent with new tools without writing code."
          action={{ label: 'Add server', onClick: startAdd, icon: 'plus' }}
        />
      )}
      {loadState === 'loaded' && connections.length > 0 && (
        <div data-testid="mcp-connections-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {connections.map((conn) => {
            const test = testResults[conn.id];
            return (
              <div
                key={conn.id}
                data-testid={`mcp-row-${conn.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto auto auto auto auto',
                  gap: 8,
                  alignItems: 'center',
                  padding: '8px 10px',
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>{conn.label}</span>
                    <Chip mono tone="info" soft title={`Connection id: ${conn.id}`}>{conn.id}</Chip>
                  </div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                    {conn.transport === 'stdio'
                      ? `stdio · ${conn.command ?? '(no command)'}`
                      : `http · ${conn.url ?? '(no url)'}`}
                  </div>
                  {test && test !== 'pending' && (
                    <div
                      data-testid={`mcp-test-result-${conn.id}`}
                      style={{
                        fontSize: 'var(--fs-xs)',
                        color: test.ok ? 'var(--success)' : 'var(--danger)',
                      }}
                    >
                      {test.ok
                        ? `Connected — ${test.toolCount ?? 0} tool${test.toolCount === 1 ? '' : 's'}`
                        : `Failed — ${test.error}`}
                    </div>
                  )}
                </div>
                <Chip tone={TRUST_TONE[conn.trustLevel]} soft>{conn.trustLevel}</Chip>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                  <input
                    type="checkbox"
                    data-testid={`mcp-enabled-${conn.id}`}
                    checked={conn.enabled}
                    onChange={() => handleToggleEnabled(conn)}
                  />
                  enabled
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleTest(conn.id)}
                  disabled={test === 'pending'}
                  data-testid={`mcp-test-${conn.id}`}
                >
                  {test === 'pending' ? 'Testing…' : 'Test'}
                </Button>
                <Button size="sm" variant="secondary" icon="edit" onClick={() => startEdit(conn)} data-testid={`mcp-edit-${conn.id}`}>
                  Edit
                </Button>
                <Button size="sm" variant="danger" onClick={() => handleDelete(conn.id)} data-testid={`mcp-delete-${conn.id}`}>
                  Delete
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={editing !== null}
        title={editing?.mode === 'edit' ? `Edit MCP server "${editing.id}"` : 'Add MCP server'}
        onClose={cancel}
        width={560}
      >
        <Field label="Connection id">
          <Input
            value={form.id}
            disabled={editing?.mode === 'edit'}
            placeholder="e.g. slack"
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            data-testid="mcp-form-id"
          />
        </Field>
        <Field label="Label">
          <Input
            value={form.label}
            placeholder="Human-readable name (shown in chat tool cards)"
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            data-testid="mcp-form-label"
          />
        </Field>
        <Field label="Transport">
          <select
            value={form.transport}
            onChange={(e) => setForm((f) => ({ ...f, transport: e.target.value as 'stdio' | 'http' }))}
            data-testid="mcp-form-transport"
            style={{
              height: 30,
              padding: '0 8px',
              fontSize: 'var(--fs-sm)',
              fontFamily: 'inherit',
              background: 'var(--bg-raised)',
              color: 'var(--text)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              outline: 'none',
            }}
          >
            <option value="stdio">stdio (subprocess)</option>
            <option value="http">streamable-http (URL)</option>
          </select>
        </Field>

        {form.transport === 'stdio' ? (
          <>
            <Field label="Command">
              <Input
                value={form.command}
                placeholder="npx -y @example/mcp-slack-server"
                onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                data-testid="mcp-form-command"
              />
            </Field>
            <Field label="Args (one per line, optional)">
              <textarea
                value={form.argsText}
                rows={3}
                onChange={(e) => setForm((f) => ({ ...f, argsText: e.target.value }))}
                data-testid="mcp-form-args"
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  fontSize: 'var(--fs-sm)',
                  fontFamily: 'var(--font-mono)',
                  background: 'var(--bg-raised)',
                  color: 'var(--text)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-sm)',
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
            </Field>
            <KeyValueEditor
              label="Environment variables"
              pairs={form.env}
              onChange={(env) => setForm((f) => ({ ...f, env }))}
              testid="mcp-form-env"
              hint="Use ${VAR_NAME} to interpolate from process.env at connect time."
            />
          </>
        ) : (
          <>
            <Field label="URL">
              <Input
                value={form.url}
                placeholder="https://mcp.example.com/sse"
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                data-testid="mcp-form-url"
              />
            </Field>
            <KeyValueEditor
              label="Headers"
              pairs={form.headers}
              onChange={(headers) => setForm((f) => ({ ...f, headers }))}
              testid="mcp-form-headers"
              hint="Use ${VAR_NAME} to interpolate from process.env at connect time."
            />
          </>
        )}

        <Field label="Trust level">
          <select
            value={form.trustLevel}
            onChange={(e) => setForm((f) => ({ ...f, trustLevel: e.target.value as FormState['trustLevel'] }))}
            data-testid="mcp-form-trust"
            style={{
              height: 30,
              padding: '0 8px',
              fontSize: 'var(--fs-sm)',
              fontFamily: 'inherit',
              background: 'var(--bg-raised)',
              color: 'var(--text)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-sm)',
              outline: 'none',
            }}
          >
            <option value="auto">auto — trust this server's tools (default-modify, follows policy)</option>
            <option value="review">review — every call from this server prompts for review</option>
            <option value="block">block — register no tools from this server</option>
          </select>
        </Field>

        <Field label="" inline>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            data-testid="mcp-form-enabled"
          />
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>Enabled</span>
        </Field>

        <Field label="Per-call timeout (ms, optional)">
          <Input
            value={form.timeout}
            placeholder="10000"
            inputMode="numeric"
            onChange={(e) => setForm((f) => ({ ...f, timeout: e.target.value }))}
            data-testid="mcp-form-timeout"
          />
        </Field>

        {formErrors.length > 0 && (
          <div
            role="alert"
            data-testid="mcp-form-errors"
            style={{
              padding: 8,
              fontSize: 'var(--fs-xs)',
              color: 'var(--danger)',
              background: 'var(--danger-soft)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {formErrors.map((e) => <div key={e}>{e}</div>)}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button size="md" variant="ghost" onClick={cancel} disabled={saving}>Cancel</Button>
          <Button size="md" variant="primary" onClick={handleSave} disabled={saving} data-testid="mcp-form-save">
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Modal>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Internal — KeyValueEditor for env / headers. Masked values keep
// their `••••••••` placeholder; the backend's masked-edit guard
// substitutes the persisted value on save.
// ---------------------------------------------------------------------------

interface KeyValueEditorProps {
  label: string;
  hint?: string;
  pairs: KvPair[];
  onChange: (next: KvPair[]) => void;
  testid: string;
}

const KeyValueEditor = ({ label, hint, pairs, onChange, testid }: KeyValueEditorProps) => {
  const update = (idx: number, patch: Partial<KvPair>) => {
    const next = pairs.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const add = () => onChange([...pairs, { key: '', value: '' }]);
  const remove = (idx: number) => onChange(pairs.filter((_, i) => i !== idx));

  return (
    <Field label={label}>
      <div data-testid={testid} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pairs.length === 0 && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>(none)</div>
        )}
        {pairs.map((p, i) => {
          const isMasked = p.value === MCP_SECRET_MASK;
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
              <Input
                value={p.key}
                placeholder="KEY"
                onChange={(e) => update(i, { key: e.target.value })}
                data-testid={`${testid}-key-${i}`}
              />
              <Input
                value={p.value}
                placeholder="value"
                onChange={(e) => update(i, { value: e.target.value })}
                title={isMasked ? 'Stored secret — clear to replace' : undefined}
                data-testid={`${testid}-value-${i}`}
                data-masked={isMasked ? 'true' : undefined}
              />
              <Button size="sm" variant="ghost" icon="close" iconOnly onClick={() => remove(i)} aria-label={`remove ${p.key || 'entry'}`} />
            </div>
          );
        })}
        <div>
          <Button size="sm" variant="secondary" icon="plus" onClick={add} data-testid={`${testid}-add`}>
            Add entry
          </Button>
        </div>
        {hint && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>{hint}</div>
        )}
      </div>
    </Field>
  );
};

export default McpServersSection;
