/**
 * Wrap a flowing row-event source (a mysql2 / mssql query stream) into an
 * OpenCursor with precise N-row chunked fetch and back-pressure: rows buffer up
 * to a high-water mark, then the source is paused; fetch(n) resumes it only as
 * far as needed. This isolates the tricky async streaming logic from the
 * driver-specific wiring so it can be tested with a fake source (no real DB).
 */
import type { OpenCursor } from './types.js';

export interface RowSource {
  on(event: 'row', cb: (row: unknown[]) => void): void;
  on(event: 'end', cb: () => void): void;
  on(event: 'error', cb: (e: Error) => void): void;
  pause(): void;
  resume(): void;
  destroy?(): void;
}

export function createBufferedRowCursor(
  source: RowSource,
  columns: string[],
  opts: { highWater?: number } = {},
): OpenCursor {
  const highWater = opts.highWater ?? 500;
  const buffer: unknown[][] = [];
  let ended = false;
  let error: Error | null = null;
  let paused = false;
  let closed = false;
  let notify: (() => void) | null = null;
  const wake = () => { const f = notify; notify = null; f?.(); };

  source.on('row', (row) => { buffer.push(row); if (buffer.length >= highWater && !paused) { paused = true; source.pause(); } wake(); });
  source.on('end', () => { ended = true; wake(); });
  source.on('error', (e) => { error = e; wake(); });

  const resumeIfNeeded = () => { if (paused && !ended && !error && !closed) { paused = false; source.resume(); } };

  const cursor: OpenCursor = {
    columns,
    async fetch(n) {
      const want = Math.max(1, n);
      while (buffer.length < want && !ended && !error) {
        resumeIfNeeded();
        await new Promise<void>((res) => { notify = res; });
      }
      if (error) { const e = error; await cursor.close(); throw e; }
      const rows = buffer.splice(0, want);
      const done = ended && buffer.length === 0;
      if (done) { await cursor.close(); } else { resumeIfNeeded(); }
      return { rows, done };
    },
    async close() {
      if (closed) return;
      closed = true;
      try { source.destroy?.(); } catch { /* best-effort */ }
    },
  };
  return cursor;
}
