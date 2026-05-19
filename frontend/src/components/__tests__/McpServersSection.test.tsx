/**
 * McpServersSection — Settings UI for MCP connections (#178 slice 2).
 *
 * Covers the basics: empty state, render existing connections from
 * the service, masked secrets keep their `••••••••` placeholder
 * when round-tripped, test button surfaces probe results, delete
 * removes a row. The detailed wire-shape masking behaviour lives in
 * `backend/.../mcp.routes.test.ts`; here we only assert the
 * frontend doesn't fight the masked-edit guard.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import McpServersSection from '../McpServersSection';
import {
  MCP_SECRET_MASK,
  type McpConnection,
  type McpTestResult,
  type McpConnectionTool,
} from '../../plugins/ai-assistance/services/McpService';

// Build a hand-rolled fake of the service that the component injects.
// In-memory state, deterministic ordering — the suite never touches
// axios or MSW.
function makeFakeService() {
  const state: { connections: McpConnection[] } = { connections: [] };
  const calls: {
    upsert: McpConnection[];
    remove: string[];
    test: string[];
    listToolsForConnection: string[];
  } = { upsert: [], remove: [], test: [], listToolsForConnection: [] };
  const testResults: Record<string, McpTestResult> = {};
  const toolsByConnection: Record<string, McpConnectionTool[]> = {};
  return {
    state,
    calls,
    testResults,
    toolsByConnection,
    list: vi.fn(async () => state.connections.slice()),
    upsert: vi.fn(async (conn: McpConnection) => {
      calls.upsert.push(conn);
      const idx = state.connections.findIndex((c) => c.id === conn.id);
      if (idx >= 0) state.connections[idx] = conn;
      else state.connections.push(conn);
      return conn;
    }),
    remove: vi.fn(async (id: string) => {
      calls.remove.push(id);
      state.connections = state.connections.filter((c) => c.id !== id);
    }),
    test: vi.fn(async (id: string): Promise<McpTestResult> => {
      calls.test.push(id);
      return testResults[id] ?? { ok: true, toolCount: 0 };
    }),
    listToolsForConnection: vi.fn(async (id: string): Promise<McpConnectionTool[]> => {
      calls.listToolsForConnection.push(id);
      return toolsByConnection[id] ?? [];
    }),
  };
}

beforeEach(() => {
  // jsdom doesn't implement window.confirm — stub it so handleDelete
  // doesn't bail.
  window.confirm = vi.fn(() => true);
});

describe('McpServersSection', () => {
  it('renders empty state and opens the add modal', async () => {
    const service = makeFakeService();
    render(<McpServersSection service={service as any} />);

    await waitFor(() => {
      expect(screen.getByText(/No MCP servers yet/i)).toBeInTheDocument();
    });
    expect(service.list).toHaveBeenCalledTimes(1);

    const headerAdd = screen.getByTestId('mcp-add-button');
    await userEvent.click(headerAdd);
    expect(screen.getByTestId('mcp-form-id')).toBeInTheDocument();
  });

  it('lists existing connections with their transport summary and trust chip', async () => {
    const service = makeFakeService();
    service.state.connections = [
      {
        id: 'slack',
        label: 'Slack',
        transport: 'stdio',
        command: 'npx -y @example/mcp-slack',
        env: { SLACK_TOKEN: MCP_SECRET_MASK },
        enabled: true,
        trustLevel: 'auto',
      },
      {
        id: 'remote',
        label: 'Remote',
        transport: 'http',
        url: 'https://example.com/mcp',
        enabled: false,
        trustLevel: 'block',
      },
    ];

    render(<McpServersSection service={service as any} />);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-row-slack')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-row-remote')).toBeInTheDocument();
    });

    expect(screen.getByText(/stdio · npx -y @example\/mcp-slack/)).toBeInTheDocument();
    expect(screen.getByText('https://example.com/mcp', { exact: false })).toBeInTheDocument();
    // Trust chip text.
    expect(screen.getByText('auto')).toBeInTheDocument();
    expect(screen.getByText('block')).toBeInTheDocument();
  });

  it('round-trips a masked env value when the user saves an edit without touching it', async () => {
    const service = makeFakeService();
    service.state.connections = [{
      id: 'slack',
      label: 'Slack',
      transport: 'stdio',
      command: 'npx',
      env: { SLACK_TOKEN: MCP_SECRET_MASK },
      enabled: true,
      trustLevel: 'auto',
    }];

    render(<McpServersSection service={service as any} />);
    await waitFor(() => expect(screen.getByTestId('mcp-row-slack')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('mcp-edit-slack'));

    // Only the label is changed — secrets stay masked.
    const labelInput = screen.getByTestId('mcp-form-label') as HTMLInputElement;
    expect(labelInput.value).toBe('Slack');
    await userEvent.clear(labelInput);
    await userEvent.type(labelInput, 'Slack (renamed)');

    // The token field still shows the mask sentinel.
    const tokenInput = screen.getByTestId('mcp-form-env-value-0') as HTMLInputElement;
    expect(tokenInput.value).toBe(MCP_SECRET_MASK);
    expect(tokenInput).toHaveAttribute('data-masked', 'true');

    await userEvent.click(screen.getByTestId('mcp-form-save'));

    await waitFor(() => expect(service.upsert).toHaveBeenCalledTimes(1));
    const sent = service.calls.upsert[0];
    expect(sent.label).toBe('Slack (renamed)');
    // Crucial: the mask is sent BACK unchanged. The backend's
    // masked-edit guard substitutes the real value at save time.
    expect(sent.env?.SLACK_TOKEN).toBe(MCP_SECRET_MASK);
  });

  it('runs Test and surfaces probe results inline on the row', async () => {
    const service = makeFakeService();
    service.state.connections = [{
      id: 'slack', label: 'Slack', transport: 'stdio', command: 'npx',
      enabled: true, trustLevel: 'auto',
    }];
    service.testResults['slack'] = { ok: true, toolCount: 7 };

    render(<McpServersSection service={service as any} />);
    await waitFor(() => expect(screen.getByTestId('mcp-row-slack')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('mcp-test-slack'));

    await waitFor(() => {
      const result = screen.getByTestId('mcp-test-result-slack');
      expect(result.textContent).toMatch(/Connected.*7 tools/);
    });
  });

  it('deletes a connection after confirmation and refreshes the list', async () => {
    const service = makeFakeService();
    service.state.connections = [{
      id: 'slack', label: 'Slack', transport: 'stdio', command: 'npx',
      enabled: true, trustLevel: 'auto',
    }];

    render(<McpServersSection service={service as any} />);
    await waitFor(() => expect(screen.getByTestId('mcp-row-slack')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('mcp-delete-slack'));

    await waitFor(() => {
      expect(screen.queryByTestId('mcp-row-slack')).not.toBeInTheDocument();
      expect(screen.getByText(/No MCP servers yet/i)).toBeInTheDocument();
    });
    expect(service.calls.remove).toEqual(['slack']);
  });

  it('toggling the enabled checkbox upserts with the inverted value', async () => {
    const service = makeFakeService();
    service.state.connections = [{
      id: 'slack', label: 'Slack', transport: 'stdio', command: 'npx',
      enabled: true, trustLevel: 'auto',
      env: { SLACK_TOKEN: MCP_SECRET_MASK },
    }];

    render(<McpServersSection service={service as any} />);
    await waitFor(() => expect(screen.getByTestId('mcp-row-slack')).toBeInTheDocument());

    await act(async () => {
      await userEvent.click(screen.getByTestId('mcp-enabled-slack'));
    });

    await waitFor(() => expect(service.upsert).toHaveBeenCalledTimes(1));
    expect(service.calls.upsert[0].enabled).toBe(false);
    // Masked env round-trips on the toggle path too.
    expect(service.calls.upsert[0].env?.SLACK_TOKEN).toBe(MCP_SECRET_MASK);
  });

  it('shows tools when expanded, lazily fetched once and cached on toggle', async () => {
    const service = makeFakeService();
    service.state.connections = [{
      id: 'slack', label: 'Slack', transport: 'stdio', command: 'npx',
      enabled: true, trustLevel: 'auto',
    }];
    service.toolsByConnection['slack'] = [
      { name: 'slack.sendMessage', rawName: 'sendMessage', description: 'Post to a channel' },
      { name: 'slack.listChannels', rawName: 'listChannels', description: 'List channels' },
    ];

    render(<McpServersSection service={service as any} />);
    await waitFor(() => expect(screen.getByTestId('mcp-row-slack')).toBeInTheDocument());

    const toggle = screen.getByTestId('mcp-tools-toggle-slack');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByTestId('mcp-tool-slack-sendMessage')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-tool-slack-listChannels')).toBeInTheDocument();
    });
    expect(service.listToolsForConnection).toHaveBeenCalledTimes(1);

    // Collapse, then expand again — must reuse the cache.
    await userEvent.click(toggle);
    expect(screen.queryByTestId('mcp-tool-slack-sendMessage')).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.getByTestId('mcp-tool-slack-sendMessage')).toBeInTheDocument();
    expect(service.listToolsForConnection).toHaveBeenCalledTimes(1);
  });

  it('renders an empty hint when a connection has no live tools', async () => {
    const service = makeFakeService();
    service.state.connections = [{
      id: 'remote', label: 'Remote', transport: 'http', url: 'https://example.com',
      enabled: false, trustLevel: 'review',
    }];
    service.toolsByConnection['remote'] = [];

    render(<McpServersSection service={service as any} />);
    await waitFor(() => expect(screen.getByTestId('mcp-row-remote')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('mcp-tools-toggle-remote'));

    await waitFor(() => {
      const panel = screen.getByTestId('mcp-tools-list-remote');
      expect(panel.textContent).toMatch(/No tools available/i);
    });
  });

  it('surfaces a fetch error inline in the tools panel', async () => {
    const service = makeFakeService();
    service.state.connections = [{
      id: 'flaky', label: 'Flaky', transport: 'stdio', command: 'npx',
      enabled: true, trustLevel: 'auto',
    }];
    service.listToolsForConnection = vi.fn(async () => {
      throw new Error('manifest endpoint returned 500');
    });

    render(<McpServersSection service={service as any} />);
    await waitFor(() => expect(screen.getByTestId('mcp-row-flaky')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('mcp-tools-toggle-flaky'));

    await waitFor(() => {
      const panel = screen.getByTestId('mcp-tools-list-flaky');
      expect(panel.textContent).toMatch(/manifest endpoint returned 500/);
    });
  });

  it('opens the catalog, prefills the add-form from an entry, and round-trips the entry to upsert', async () => {
    const service = makeFakeService();
    render(<McpServersSection service={service as any} />);

    await waitFor(() => expect(screen.getByText(/No MCP servers yet/i)).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('mcp-browse-button'));

    // Catalog renders every registry entry.
    expect(screen.getByTestId('mcp-catalog-list')).toBeInTheDocument();
    const slackEntry = screen.getByTestId('mcp-catalog-entry-slack');
    expect(slackEntry.textContent).toMatch(/Slack/);
    expect(slackEntry.textContent).toMatch(/SLACK_BOT_TOKEN/);

    // Install pre-fills the standard add-form with the entry's defaults.
    await userEvent.click(screen.getByTestId('mcp-catalog-install-slack'));

    const idField = screen.getByTestId('mcp-form-id') as HTMLInputElement;
    const labelField = screen.getByTestId('mcp-form-label') as HTMLInputElement;
    expect(idField.value).toBe('slack');
    expect(labelField.value).toBe('Slack');

    // The env defaults pre-fill as ${VAR} refs so the user can either
    // leave them alone or replace with literals.
    const tokenValue = screen.getByTestId('mcp-form-env-value-0') as HTMLInputElement;
    expect(tokenValue.value).toBe('${SLACK_BOT_TOKEN}');

    // Save round-trips the entry to upsert untouched.
    await userEvent.click(screen.getByTestId('mcp-form-save'));

    await waitFor(() => expect(service.upsert).toHaveBeenCalledTimes(1));
    const sent = service.calls.upsert[0];
    expect(sent.id).toBe('slack');
    expect(sent.label).toBe('Slack');
    expect(sent.transport).toBe('stdio');
    expect(sent.command).toBe('npx');
    expect(sent.env?.SLACK_BOT_TOKEN).toBe('${SLACK_BOT_TOKEN}');
    expect(sent.trustLevel).toBe('review');
  });

  it('marks a catalog entry "Already installed" when its id is already a connection', async () => {
    const service = makeFakeService();
    service.state.connections = [{
      id: 'slack', label: 'Slack', transport: 'stdio', command: 'npx',
      enabled: true, trustLevel: 'auto',
    }];

    render(<McpServersSection service={service as any} />);
    await waitFor(() => expect(screen.getByTestId('mcp-row-slack')).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('mcp-browse-button'));

    const slackEntry = screen.getByTestId('mcp-catalog-entry-slack');
    expect(slackEntry.textContent).toMatch(/Already installed/i);
    // The Install button is gone for an already-installed entry.
    expect(screen.queryByTestId('mcp-catalog-install-slack')).not.toBeInTheDocument();

    // Other entries still installable.
    expect(screen.getByTestId('mcp-catalog-install-github')).toBeInTheDocument();
  });

  it('surfaces 400 validation errors from the backend', async () => {
    const service = makeFakeService();
    // Replace upsert with one that throws a faux axios 400.
    service.upsert = vi.fn(async () => {
      const err = new Error('Request failed with status code 400') as Error & {
        response: { data: { errors: string[] } };
      };
      err.response = { data: { errors: ['id must not be empty', 'label must not be empty'] } };
      throw err;
    });

    render(<McpServersSection service={service as any} />);
    await waitFor(() => expect(screen.getByText(/No MCP servers yet/i)).toBeInTheDocument());

    await userEvent.click(screen.getByTestId('mcp-add-button'));
    // Save the empty form — backend will reject.
    await userEvent.click(screen.getByTestId('mcp-form-save'));

    await waitFor(() => {
      const errors = screen.getByTestId('mcp-form-errors');
      expect(errors.textContent).toMatch(/id must not be empty/);
      expect(errors.textContent).toMatch(/label must not be empty/);
    });
  });
});
