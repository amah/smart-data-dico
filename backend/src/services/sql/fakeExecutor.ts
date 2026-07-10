/**
 * In-memory CursorExecutor for tests and local/demo use — exercises the whole
 * run/fetch/close framework (chunked fetch, registry lifecycle, guards) without
 * a real database. Production dialect adapters implement the same interface.
 */
import type { CursorExecutor, DbConnection, OpenCursor } from './types.js';

export class FakeCursor implements OpenCursor {
  private i = 0;
  public closed = false;
  constructor(public columns: string[], private rows: unknown[][]) {}
  async fetch(n: number): Promise<{ rows: unknown[][]; done: boolean }> {
    if (this.closed) throw new Error('cursor closed');
    const slice = this.rows.slice(this.i, this.i + Math.max(0, n));
    this.i += slice.length;
    return { rows: slice, done: this.i >= this.rows.length };
  }
  async close(): Promise<void> { this.closed = true; }
}

export class FakeExecutor implements CursorExecutor {
  public opened: FakeCursor[] = [];
  /** The exact statement text last handed to the driver (tests assert on it). */
  public lastSql: string | null = null;
  constructor(
    private dataset: { columns: string[]; rows: unknown[][] },
    private opts: { failOnContains?: string } = {},
  ) {}
  async open(_conn: DbConnection, sql: string): Promise<OpenCursor> {
    this.lastSql = sql;
    if (this.opts.failOnContains && sql.includes(this.opts.failOnContains)) {
      throw new Error(`fake DB error near "${this.opts.failOnContains}"`);
    }
    const cur = new FakeCursor(this.dataset.columns, this.dataset.rows);
    this.opened.push(cur);
    return cur;
  }
}
