/**
 * Commands Debug Page — #163 Phase 6.
 *
 * Reads the in-process command registry only — no backend call.
 *
 * The framework's CommandRegistry does NOT expose a listing API
 * (verified at @hamak/microkernel-api/dist/types.d.ts — the type has only
 * `register`, `run`, `has`). This page renders from the static `CommandMap`
 * defined in `kernel/commands.ts`, validating each name via
 * `commands.has(name)` so the page can flag any drift between the type-map
 * and the runtime registry.
 *
 * Notification commands from the framework plugin and any future
 * plugin-internal commands not in CommandMap are not surfaced here —
 * that is a follow-up once the framework adds `commands.list` or we maintain
 * a manifest. Out of scope for Slice 1.
 */

import React from 'react';
import { host } from '../kernel/bootstrap';
import type { CommandName } from '../kernel/commands';

/** Static list of all 19 CommandMap keys. Kept in sync with CommandMap. */
const COMMAND_MAP_KEYS: CommandName[] = [
  'data-dictionary.stereotype.loadAll',
  'data-dictionary.stereotype.create',
  'data-dictionary.stereotype.update',
  'data-dictionary.stereotype.delete',
  'data-dictionary.integrity.getReport',
  'data-dictionary.diff.getLogical',
  'data-dictionary.diff.getPhysicalConfig',
  'data-dictionary.diff.getPhysicalForService',
  'data-dictionary.diff.getPhysicalAll',
  'data-dictionary.import-export.importJsonSchema',
  'data-dictionary.import-export.importSqlDdl',
  'data-dictionary.import-export.previewSqlDdl',
  'data-dictionary.import-export.previewDbSchema',
  'data-dictionary.import-export.diffSqlDdl',
  'data-dictionary.import-export.commitSqlDdl',
  'data-dictionary.import-export.exportJsonSchema',
  'data-dictionary.import-export.exportMarkdown',
  'data-dictionary.quality.getReport',
  'search.search',
];

export function CommandsDebugPage(): JSX.Element {
  const ctx = host.rootActivationCtx;
  const registryReady = !!ctx;

  const rows = COMMAND_MAP_KEYS.map((name) => {
    const registered = registryReady ? ctx!.commands.has(name) : false;
    return { name, registered };
  });

  const unregisteredCount = rows.filter((r) => !r.registered).length;

  return (
    <div style={{ padding: 16, fontFamily: 'var(--font-mono, monospace)' }}>
      <h1
        style={{
          fontSize: 'var(--fs-2xl, 1.5rem)',
          fontWeight: 600,
          marginBottom: 8,
          letterSpacing: '-0.02em',
        }}
      >
        Commands Debug
      </h1>
      <p
        style={{
          fontSize: 'var(--fs-sm, 0.875rem)',
          color: 'var(--text-muted, #888)',
          marginBottom: 16,
        }}
      >
        Shows all 19 commands from the static <code>CommandMap</code>.
        Each row is probed via <code>commands.has(name)</code> against the
        live runtime registry.
        {!registryReady && (
          <span style={{ color: 'var(--warning, orange)', marginLeft: 8 }}>
            Host not bootstrapped — registry unavailable.
          </span>
        )}
        {registryReady && unregisteredCount > 0 && (
          <span style={{ color: 'var(--warning, orange)', marginLeft: 8 }}>
            {unregisteredCount} command{unregisteredCount > 1 ? 's' : ''} not registered in the runtime registry.
          </span>
        )}
        {registryReady && unregisteredCount === 0 && (
          <span style={{ color: 'var(--success, green)', marginLeft: 8 }}>
            All {COMMAND_MAP_KEYS.length} commands are registered.
          </span>
        )}
      </p>

      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 'var(--fs-sm, 0.875rem)',
        }}
      >
        <thead>
          <tr
            style={{
              background: 'var(--bg-subtle, #f4f4f4)',
              borderBottom: '1px solid var(--border, #ddd)',
            }}
          >
            <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Command name</th>
            <th style={{ textAlign: 'center', padding: '6px 10px', fontWeight: 600, width: 120 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.name}
              data-testid={row.registered ? 'command-row-registered' : 'command-row-unregistered'}
              style={{
                borderBottom: '1px solid var(--border, #eee)',
                background: row.registered ? 'transparent' : 'var(--danger-soft, #fff0f0)',
              }}
            >
              <td style={{ padding: '5px 10px', fontFamily: 'monospace' }}>{row.name}</td>
              <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                {row.registered ? (
                  <span style={{ color: 'var(--success, green)', fontWeight: 600 }}>registered</span>
                ) : (
                  <span
                    data-testid="not-registered-marker"
                    style={{ color: 'var(--danger, red)', fontWeight: 600 }}
                  >
                    not registered
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default CommandsDebugPage;
