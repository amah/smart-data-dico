/**
 * RawFsWatcher — #167 slice 6e.2
 *
 * Watches the workspace root via `chokidar` and fires synthetic
 * `raw-changed` projection invalidation events when YAML files are
 * mutated outside the projection layer (frontend `/fs/raw` writes,
 * git operations, external editors).
 *
 * Self-write suppression: the projection registers each physical path it
 * touches in `LogicalProjection.suppressNextWrite(...)` immediately before
 * its on-disk write completes. This watcher checks `projection.isSuppressed(...)`
 * before emitting and skips paths whose suppression window is still open
 * — preventing the watcher → projection → watcher event loop.
 *
 * No fs imports. The slice-5c ESLint no-restricted-imports rule blocks
 * fs and fs/promises outside an allow-list; this module relies solely on
 * chokidar (which handles its own fs access internally) and path. The
 * disk-touching test for the watcher lives under the allow-listed
 * test directory.
 */
import chokidar, { type FSWatcher } from 'chokidar';
import path from 'path';
import { logger } from '../../utils/logger.js';
import type { LogicalProjection } from './LogicalProjection.js';
import type { UuidIndex } from './UuidIndex.js';
import type { WorkspaceId } from '../contract/types.js';

export interface RawFsWatcherOptions {
  /** Absolute workspace data directory (`config.dataDir`). */
  dataDir: string;
  /** Workspace id this watcher is bound to. Stored for forward compatibility
   *  with multi-workspace coordination (#169). */
  ws: WorkspaceId;
  /** The projection whose `isSuppressed` we consult and `fireExternalInvalidation`
   *  we drive on emit. */
  projection: LogicalProjection;
  /** Reserved for future per-file targeted dispatching (slice 6e successor —
   *  see spec §7). Held but not yet read by this slice. */
  index?: UuidIndex;
  /**
   * Coalesce window: chokidar events for the same path within this many
   * milliseconds collapse into a single emission. Tests may pass `0` to
   * disable the timer-based coalescing and exercise the per-event path.
   * Default: 250 ms.
   */
  coalesceWindowMs?: number;
}

export class RawFsWatcher {
  private readonly opts: Required<Omit<RawFsWatcherOptions, 'index'>> & { index?: UuidIndex };
  private watcher: FSWatcher | null = null;
  private readonly pending = new Map<string, NodeJS.Timeout>();
  /** Captured changeKind per-path so the coalescer fires with the LAST one
   *  observed inside the window. */
  private readonly pendingKinds = new Map<string, 'add' | 'change' | 'unlink'>();

  constructor(opts: RawFsWatcherOptions) {
    this.opts = {
      dataDir: opts.dataDir,
      ws: opts.ws,
      projection: opts.projection,
      coalesceWindowMs: opts.coalesceWindowMs ?? 250,
      index: opts.index,
    };
  }

  /**
   * Begin watching. Awaits chokidar's `ready` event. Idempotent — a second
   * call returns the same in-flight watcher.
   */
  async start(): Promise<void> {
    if (this.watcher !== null) return;
    const watcher = chokidar.watch(this.opts.dataDir, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/.dico/diagrams/**',
      ],
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    watcher.on('add',    (abs) => this.dispatch('add', abs));
    watcher.on('change', (abs) => this.dispatch('change', abs));
    watcher.on('unlink', (abs) => this.dispatch('unlink', abs));
    watcher.on('error',  (err) => {
      logger.warn(`RawFsWatcher error: ${err instanceof Error ? err.message : String(err)}`);
    });

    await new Promise<void>((resolve) => {
      watcher.once('ready', () => resolve());
    });

    this.watcher = watcher;
    logger.info(`RawFsWatcher ready (dataDir=${this.opts.dataDir})`);
  }

  /** Close the watcher and clear any pending coalesce timers. */
  async stop(): Promise<void> {
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    this.pendingKinds.clear();
    if (this.watcher !== null) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Test helper. Drives the internal dispatch logic directly without a real
   * chokidar event. The path may be either absolute (under `dataDir`) or
   * already workspace-relative — both branches resolve to the same
   * workspace-relative key. Returns a promise solely so callers can `await`
   * in test setups; the underlying dispatch path is synchronous.
   */
  async __test_emit(kind: 'add' | 'change' | 'unlink', physicalPath: string): Promise<void> {
    this.dispatch(kind, physicalPath);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Private
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the physical workspace-relative path (forward-slash) and:
   *   1) drop non-YAML files,
   *   2) drop suppressed paths (self-writes),
   *   3) coalesce by path within `coalesceWindowMs`,
   *   4) on flush, call `projection.fireExternalInvalidation(...)`.
   *
   * Synchronous — all interactions (Map ops, projection.isSuppressed,
   * projection.fireExternalInvalidation) are synchronous. Keeping this sync
   * lets chokidar `.on(...)` listener arrow functions not produce floating
   * promises.
   */
  private dispatch(kind: 'add' | 'change' | 'unlink', absOrRel: string): void {
    const rel = this.toWorkspaceRelative(absOrRel);
    if (!this.isYaml(rel)) return;
    if (this.opts.projection.isSuppressed(rel)) {
      // Consumed — see LogicalProjection.isSuppressed.
      return;
    }

    this.pendingKinds.set(rel, kind);
    const existing = this.pending.get(rel);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    if (this.opts.coalesceWindowMs <= 0) {
      this.pending.delete(rel);
      const finalKind = this.pendingKinds.get(rel) ?? kind;
      this.pendingKinds.delete(rel);
      this.flush(rel, finalKind);
      return;
    }

    const timer = setTimeout(() => {
      this.pending.delete(rel);
      const finalKind = this.pendingKinds.get(rel) ?? kind;
      this.pendingKinds.delete(rel);
      this.flush(rel, finalKind);
    }, this.opts.coalesceWindowMs);
    this.pending.set(rel, timer);
  }

  /** Fire the projection event. Synchronous on the projection side. */
  private flush(rel: string, kind: 'add' | 'change' | 'unlink'): void {
    this.opts.projection.fireExternalInvalidation({
      kind: 'raw-changed',
      physicalPath: rel,
      changeKind: kind,
    });
  }

  /** Normalize an absolute or already-relative path to forward-slash workspace-relative. */
  private toWorkspaceRelative(p: string): string {
    if (path.isAbsolute(p)) {
      const rel = path.relative(this.opts.dataDir, p);
      return rel.split(path.sep).join('/');
    }
    return p.split(path.sep).join('/');
  }

  /** True for `*.yaml` / `*.yml` (case-insensitive) — anything else skipped. */
  private isYaml(rel: string): boolean {
    const lower = rel.toLowerCase();
    return lower.endsWith('.yaml') || lower.endsWith('.yml');
  }
}
