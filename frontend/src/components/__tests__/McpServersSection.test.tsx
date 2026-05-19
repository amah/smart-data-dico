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
} from '../../plugins/ai-assistance/services/McpService';

// Build a hand-rolled fake of the service that the component injects.
// In-memory state, deterministic ordering — the suite never touches
// axios or MSW.
function makeFakeService() {
  const state: { connections: McpConnection[] } = { connections: [] };
  const calls: { upsert: McpConnection[]; remove: string[]; test: string[] } = {
    upsert: [], remove: [], test: [],
  };
  const testResults: Record<string, McpTestResult> = {};
  return {
    state,
    calls,
    testResults,
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
