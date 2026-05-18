/**
 * RawFsWatcher.disk.test.ts — #167 slice 6e.2 acceptance criteria (AC10, AC11)
 *
 * Real-disk integration test: spins up a temp dir, points the watcher at it,
 * and uses `fs.writeFile` (allowed under the slice-5c test allow-list at
 * `src/**\/__tests__/**`) to verify:
 *
 *   - AC10: an external YAML write triggers a `raw-changed` event.
 *   - AC11: a projection-routed write does NOT trigger a `raw-changed` event,
 *     because the projection registers the path in `suppressNextWrite(...)`.
 *
 * Test gating: the global jest setup defaults `DICO_WATCH_RAW=0`. This test
 * explicitly opts back in by setting `DICO_WATCH_RAW=1` in beforeAll. (The
 * env var is not consumed by RawFsWatcher itself — only by server.ts boot —
 * but we set it for symmetry with the spec hazard #11.)
 */

import fs from 'fs';
import os from 'os';
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

const DICT_WS = wsId('dictionaries');

// chokidar's `awaitWriteFinish.stabilityThreshold` is 200ms plus the
// watcher's 250ms coalesce window, plus some safety. 750ms covers both.
const WATCH_PROPAGATION_MS = 750;

let tmpDir: string;
let projection: LogicalProjection;
let watcher: { stop(): Promise<void> } | null = null;
let events: ProjectionInvalidationEvent[];

beforeAll(() => {
  process.env.DICO_WATCH_RAW = '1';
});

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-watcher-'));
  // Pre-create a subdir so chokidar recurses into it.
  fs.mkdirSync(path.join(tmpDir, 'order-service'), { recursive: true });

  // Drive the watcher against a fresh projection; we don't need the in-memory
  // backend's data — only the suppression bookkeeping — but constructing one
  // keeps the type-shape sane.
  projection = new LogicalProjection(new InMemoryStorageBackend(), DICT_WS);
  events = [];
  projection.onInvalidate((e) => { events.push(e); });

  const { RawFsWatcher } = await import('../RawFsWatcher.js');
  const w = new RawFsWatcher({
    dataDir: tmpDir,
    ws: DICT_WS,
    projection,
    coalesceWindowMs: 250,
  });
  await w.start();
  watcher = w;
});

afterEach(async () => {
  if (watcher !== null) {
    await watcher.stop();
    watcher = null;
  }
  // Clean up the temp dir (best-effort).
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// ─────────────────────────────────────────────────────────────────────────────
// AC10 — external write fires raw-changed
// ─────────────────────────────────────────────────────────────────────────────

describe('AC10: external YAML write triggers raw-changed', () => {
  it('writing a .yaml file via fs.writeFileSync emits raw-changed', async () => {
    const target = path.join(tmpDir, 'order-service', 'external.model.yaml');
    fs.writeFileSync(target, 'entities: []\n');

    await new Promise(r => setTimeout(r, WATCH_PROPAGATION_MS));

    const rawEvents = events.filter(e => e.kind === 'raw-changed');
    expect(rawEvents.length).toBeGreaterThanOrEqual(1);
    // The emitted physicalPath is workspace-relative with forward slashes.
    const physicalPaths = rawEvents
      .filter((e): e is Extract<ProjectionInvalidationEvent, { kind: 'raw-changed' }> => e.kind === 'raw-changed')
      .map(e => e.physicalPath);
    expect(physicalPaths).toContain('order-service/external.model.yaml');
  }, 10000);
});

// ─────────────────────────────────────────────────────────────────────────────
// AC11 — projection self-writes are suppressed
// ─────────────────────────────────────────────────────────────────────────────

describe('AC11: projection-routed writes do NOT trigger raw-changed', () => {
  it('a path registered via suppressNextWrite is skipped by the watcher', async () => {
    const rel = 'order-service/Suppressed.model.yaml';
    const target = path.join(tmpDir, rel);

    // Pre-suppress THEN write — exactly the order the projection follows
    // (suppressNextWrite is called from inside the projection write method
    // before the disk write completes; in this disk test we simulate that
    // race by suppressing first, then writing).
    projection.suppressNextWrite(rel);
    fs.writeFileSync(target, 'entities: []\n');

    await new Promise(r => setTimeout(r, WATCH_PROPAGATION_MS));

    const rawEvents = events.filter(e => e.kind === 'raw-changed');
    expect(rawEvents).toHaveLength(0);
  }, 10000);
});
