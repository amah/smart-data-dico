/**
 * #163 Slice 1 — CommandsDebugPage render tests.
 *
 * Covers spec acceptance criterion #20:
 *   "Rendering against a host whose commands.has returns true for every
 *   CommandMap key produces a DOM with at least 19 list items. With the
 *   real bootstrap (registering all 19), zero rows render in the
 *   not-registered state."
 *
 * Two test cases:
 *   A) With a stubbed host where `commands.has` returns true for all 19
 *      names: 19 `data-testid="command-row-registered"` rows rendered,
 *      zero `data-testid="command-row-unregistered"` rows.
 *
 *   B) With the real production bootstrap (all 19 commands actually
 *      registered): zero rows carry `data-testid="command-row-unregistered"`,
 *      confirming no drift between CommandMap and the runtime registry.
 *
 * The page renders from the static `COMMAND_MAP_KEYS` array in
 * `CommandsDebugPage.tsx` (19 entries) and probes each via
 * `host.rootActivationCtx.commands.has(name)`. If `rootActivationCtx` is
 * undefined (pre-bootstrap), all rows are `command-row-unregistered`.
 *
 * Bootstrap strategy for real-bootstrap case: same as
 * `StereotypesPage.bootstrap.test.tsx` — the production
 * `bootstrapApplication()` mutates the singleton `host`. Idempotent.
 *
 * Note on the host singleton: `CommandsDebugPage` reads the `host` singleton
 * directly from `kernel/bootstrap.ts` at render time. For test case A we
 * spy on `host.rootActivationCtx.commands.has` after the real bootstrap to
 * return true unconditionally (which it already does for all 19 registered
 * commands, so the spy here is a belt-and-suspenders no-op for the positive
 * path). For test case B we use the real un-patched host.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';

import { bootstrapApplication, host } from '../../kernel/bootstrap';
import { CommandsDebugPage } from '../CommandsDebugPage';

const TOTAL_COMMANDS = 19;

const SAMPLE_COMMAND_NAMES = [
  'data-dictionary.stereotype.loadAll',
  'data-dictionary.integrity.getReport',
  'data-dictionary.quality.getReport',
  'data-dictionary.import-export.commitSqlDdl',
  'search.search',
] as const;

beforeAll(async () => {
  await bootstrapApplication();
});

// ── Test case A — stub host: all 19 has() → true ─────────────────────────

describe('CommandsDebugPage — stubbed host (all has → true)', () => {
  it('renders exactly 19 command rows when all commands are registered', () => {
    // The page reads `host.rootActivationCtx` at render time. After
    // bootstrapApplication() it is defined. Spy on `has` to always return
    // true (it already does, but this makes the test self-documenting).
    const hasSpy = vi.spyOn(host.rootActivationCtx!.commands, 'has').mockReturnValue(true);

    render(React.createElement(CommandsDebugPage));

    const registeredRows = screen.getAllByTestId('command-row-registered');
    expect(registeredRows).toHaveLength(TOTAL_COMMANDS);

    hasSpy.mockRestore();
  });

  it('renders zero "not-registered" rows when all commands are registered', () => {
    const hasSpy = vi.spyOn(host.rootActivationCtx!.commands, 'has').mockReturnValue(true);

    render(React.createElement(CommandsDebugPage));

    const unregisteredRows = screen.queryAllByTestId('command-row-unregistered');
    expect(unregisteredRows).toHaveLength(0);

    hasSpy.mockRestore();
  });

  it('renders zero "not-registered-marker" elements when all commands are registered', () => {
    const hasSpy = vi.spyOn(host.rootActivationCtx!.commands, 'has').mockReturnValue(true);

    render(React.createElement(CommandsDebugPage));

    const markers = screen.queryAllByTestId('not-registered-marker');
    expect(markers).toHaveLength(0);

    hasSpy.mockRestore();
  });

  it('when one command returns has → false, one "not-registered" row appears', () => {
    const hasSpy = vi.spyOn(host.rootActivationCtx!.commands, 'has').mockImplementation(
      (name: string) => name !== 'search.search',
    );

    render(React.createElement(CommandsDebugPage));

    const unregisteredRows = screen.queryAllByTestId('command-row-unregistered');
    expect(unregisteredRows).toHaveLength(1);

    const notRegisteredMarkers = screen.queryAllByTestId('not-registered-marker');
    expect(notRegisteredMarkers).toHaveLength(1);

    hasSpy.mockRestore();
  });
});

// ── Test case B — real bootstrap: zero drift ──────────────────────────────

describe('CommandsDebugPage — real bootstrap (no spy)', () => {
  it('zero rows are in the not-registered state (no drift between CommandMap and runtime registry)', () => {
    render(React.createElement(CommandsDebugPage));

    const unregisteredRows = screen.queryAllByTestId('command-row-unregistered');
    expect(unregisteredRows).toHaveLength(0);
  });

  it('all 19 rows are in the registered state', () => {
    render(React.createElement(CommandsDebugPage));

    const registeredRows = screen.getAllByTestId('command-row-registered');
    expect(registeredRows).toHaveLength(TOTAL_COMMANDS);
  });

  it('sample command names appear in the rendered DOM', () => {
    render(React.createElement(CommandsDebugPage));

    for (const name of SAMPLE_COMMAND_NAMES) {
      // Each command name is rendered as text in a <td>
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('page renders without throwing (no "host not bootstrapped" error)', () => {
    expect(() => render(React.createElement(CommandsDebugPage))).not.toThrow();
  });
});
