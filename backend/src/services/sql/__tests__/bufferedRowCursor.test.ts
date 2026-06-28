import { EventEmitter } from 'events';
import { createBufferedRowCursor, type RowSource } from '../bufferedRowCursor.js';

/** A controllable fake stream: emits rows on demand, tracks pause/resume/destroy. */
class FakeSource extends EventEmitter implements RowSource {
  public paused = false;
  public destroyed = false;
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  destroy() { this.destroyed = true; }
  emitRow(row: unknown[]) { this.emit('row', row); }
  emitEnd() { this.emit('end'); }
  emitError(e: Error) { this.emit('error', e); }
}

describe('createBufferedRowCursor', () => {
  it('returns precise N-row chunks and reports done on exhaustion', async () => {
    const src = new FakeSource();
    const cur = createBufferedRowCursor(src, ['id']);
    // preload some rows
    src.emitRow([1]); src.emitRow([2]); src.emitRow([3]);
    let r = await cur.fetch(2);
    expect(r.rows).toEqual([[1], [2]]);
    expect(r.done).toBe(false);
    // ask for 2 but only 1 buffered, then stream ends
    const p = cur.fetch(2);
    src.emitEnd();
    r = await p;
    expect(r.rows).toEqual([[3]]);
    expect(r.done).toBe(true);
    expect(src.destroyed).toBe(true); // closed on exhaustion
  });

  it('applies back-pressure (pauses past the high-water mark) and resumes on fetch', async () => {
    const src = new FakeSource();
    const cur = createBufferedRowCursor(src, ['x'], { highWater: 2 });
    src.emitRow([1]); // 1 buffered
    expect(src.paused).toBe(false);
    src.emitRow([2]); // hits high-water → pause
    expect(src.paused).toBe(true);
    const r = await cur.fetch(1); // drains one, resumes
    expect(r.rows).toEqual([[1]]);
    expect(src.paused).toBe(false);
  });

  it('waits for rows that arrive after fetch() is called', async () => {
    const src = new FakeSource();
    const cur = createBufferedRowCursor(src, ['x']);
    const p = cur.fetch(2);
    setTimeout(() => { src.emitRow(['a']); src.emitRow(['b']); }, 5);
    const r = await p;
    expect(r.rows).toEqual([['a'], ['b']]);
  });

  it('propagates a stream error and closes', async () => {
    const src = new FakeSource();
    const cur = createBufferedRowCursor(src, ['x']);
    const p = cur.fetch(1);
    src.emitError(new Error('boom'));
    await expect(p).rejects.toThrow('boom');
    expect(src.destroyed).toBe(true);
  });
});
