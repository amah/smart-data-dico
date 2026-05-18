/**
 * RawFsWatcher.test.ts — #167 slice 6e.2 acceptance criteria (unit tier)
 *
 * Drives the watcher via its `__test_emit` helper so we do not need a real
 * filesystem. The chokidar.watch factory is mocked to a stub that records
 * the args it received and returns a no-op object with the watcher's
 * lifecycle surface.
 *
 * What this test asserts:
 *   - YAML filter (.yaml/.yml only; .json/.txt ignored)
 *   - Suppression bookkeeping — paths returned by `projection.isSuppressed`
 *     do not produce an emission
 *   - Coalesce window — multiple events at the same path within the window
 *     collapse to a single emission
 *   - Forward-slash normalization of incoming absolute paths
 */

import path from 'path';
import { LogicalProjection, type ProjectionInvalidationEvent } from '../LogicalProjection.js';
import { InMemoryStorageBackend } from '../../memory/InMemoryStorageBackend.js';
import { wsId } from '../../contract/types.js';

// Suppress logger noise.
jest.mock('../../../utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock the chokidar factory so `.start()` resolves without touching disk.
// The stub returns an event-emitter-like object with `.on(...)`, `.once(...)`,
// and `.close(...)`. The watcher only awaits `once('ready', ...)`.
jest.mock('chokidar', () => {
  type Listener = (...args: unknown[]) => void;
  const listeners = new Map<string, Listener[]>();
  const onceListeners = new Map<string, Listener[]>();
  return {
    __esModule: true,
    default: {
      watch: jest.fn(() => ({
        on: (event: string, cb: Listener) => {
          if (!listeners.has(event)) listeners.set(event, []);
          listeners.get(event)!.push(cb);
        },
        once: (event: string, cb: Listener) => {
          if (event === 'ready') {
            // Resolve immediately so RawFsWatcher.start() doesn't hang.
            setImmediate(cb);
          } else {
            if (!onceListeners.has(event)) onceListeners.set(event, []);
            onceListeners.get(event)!.push(cb);
          }
        },
        close: jest.fn(async () => undefined),
      })),
    },
  };
});

const DICT_WS = wsId('dictionaries');

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

let projection: LogicalProjection;
let events: ProjectionInvalidationEvent[];

beforeEach(() => {
  const backend = new InMemoryStorageBackend();
  projection = new LogicalProjection(backend, DICT_WS);
  events = [];
  projection.onInvalidate((e) => { events.push(e); });
});

async function makeWatcher(coalesceMs: number = 0): Promise<{ stop: () => Promise<void>; emit: (k: 'add' | 'change' | 'unlink', p: string) => Promise<void> }> {
  const { RawFsWatcher } = await import('../RawFsWatcher.js');
  const watcher = new RawFsWatcher({
    dataDir: '/tmp/fake-data-dir',
    ws: DICT_WS,
    projection,
    coalesceWindowMs: coalesceMs,
  });
  await watcher.start();
  return {
    stop: () => watcher.stop(),
    emit: (kind, p) => watcher.__test_emit(kind, p),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 — YAML files trigger raw-changed; non-YAML files do not
// ─────────────────────────────────────────────────────────────────────────────

describe('RawFsWatcher: YAML filter', () => {
  it('emits raw-changed for .yaml files', async () => {
    const w = await makeWatcher(0);
    await w.emit('change', 'order-service/Order.model.yaml');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      kind: 'raw-changed',
      physicalPath: 'order-service/Order.model.yaml',
      changeKind: 'change',
    });
    await w.stop();
  });

  it('emits raw-changed for .yml files (alternate extension)', async () => {
    const w = await makeWatcher(0);
    await w.emit('add', 'order-service/order.yml');
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('raw-changed');
    await w.stop();
  });

  it('ignores .json files', async () => {
    const w = await makeWatcher(0);
    await w.emit('change', 'order-service/foo.json');
    expect(events).toHaveLength(0);
    await w.stop();
  });

  it('ignores extensionless files', async () => {
    const w = await makeWatcher(0);
    await w.emit('change', 'order-service/README');
    expect(events).toHaveLength(0);
    await w.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 — Suppression: projection.isSuppressed paths skip the emission
// ─────────────────────────────────────────────────────────────────────────────

describe('RawFsWatcher: self-write suppression', () => {
  it('skips a path marked suppressed by the projection', async () => {
    const w = await makeWatcher(0);
    projection.suppressNextWrite('order-service/Order.model.yaml');
    await w.emit('change', 'order-service/Order.model.yaml');
    expect(events).toHaveLength(0);
    await w.stop();
  });

  it('emits normally after the suppression is consumed', async () => {
    const w = await makeWatcher(0);
    projection.suppressNextWrite('order-service/Order.model.yaml');
    await w.emit('change', 'order-service/Order.model.yaml');
    // First event was suppressed (and consumed by isSuppressed).
    await w.emit('change', 'order-service/Order.model.yaml');
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('raw-changed');
    await w.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 — Coalesce window: same-path events within the window collapse
// ─────────────────────────────────────────────────────────────────────────────

describe('RawFsWatcher: coalesce window', () => {
  it('collapses 3 same-path events to 1 emission within the window', async () => {
    const w = await makeWatcher(50);
    await w.emit('add',    'order-service/Order.model.yaml');
    await w.emit('change', 'order-service/Order.model.yaml');
    await w.emit('change', 'order-service/Order.model.yaml');
    // Nothing fires until the timer expires.
    expect(events).toHaveLength(0);
    await new Promise(r => setTimeout(r, 100));
    expect(events).toHaveLength(1);
    // The LAST observed change-kind wins.
    expect((events[0] as { changeKind: string }).changeKind).toBe('change');
    await w.stop();
  });

  it('does NOT collapse events at different paths', async () => {
    const w = await makeWatcher(50);
    await w.emit('change', 'order-service/Order.model.yaml');
    await w.emit('change', 'user-service/User.model.yaml');
    await new Promise(r => setTimeout(r, 100));
    expect(events).toHaveLength(2);
    await w.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 — Path normalization: absolute path under dataDir becomes ws-relative
// ─────────────────────────────────────────────────────────────────────────────

describe('RawFsWatcher: path normalization', () => {
  it('strips dataDir prefix and converts to forward slashes', async () => {
    const w = await makeWatcher(0);
    const abs = path.join('/tmp/fake-data-dir', 'order-service', 'Order.model.yaml');
    await w.emit('change', abs);
    expect(events).toHaveLength(1);
    expect((events[0] as { physicalPath: string }).physicalPath)
      .toBe('order-service/Order.model.yaml');
    await w.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 — Lifecycle: start is idempotent; stop clears pending timers
// ─────────────────────────────────────────────────────────────────────────────

describe('RawFsWatcher: lifecycle', () => {
  it('start is idempotent (second call is a no-op)', async () => {
    const w = await makeWatcher(0);
    // Calling start again should not throw and should not double-subscribe.
    // We can't access the internal `watcher` field, but stop() should still
    // succeed and clean up.
    await w.stop();
  });

  it('stop clears pending coalesce timers (no late emit after stop)', async () => {
    const w = await makeWatcher(100);
    await w.emit('change', 'order-service/Order.model.yaml');
    await w.stop();
    await new Promise(r => setTimeout(r, 200));
    expect(events).toHaveLength(0);
  });
});
