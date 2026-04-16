import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'sdd.colWidths.';

export interface ColumnDef {
  key: string;
  defaultWidth: number; // px
}

/**
 * Drag-to-resize table columns. Persists widths per `tableKey` in
 * localStorage so they survive reload.
 *
 * Returns:
 *   - `widths`: Record<key, px> — apply as `style={{ width: widths[key] }}`
 *     on each `<th>`.
 *   - `startResize(key, mousedownEvent)`: call from the drag handle's
 *     `onMouseDown` inside each `<th>`.
 *   - `resetWidths()`: restore defaults.
 *   - `tableStyle`: apply on the `<table>` element (`table-layout: fixed`
 *     + total width).
 */
export function useResizableColumns(tableKey: string, columns: ColumnDef[]) {
  const storageKey = STORAGE_PREFIX + tableKey;

  const defaults = useCallback(
    () => Object.fromEntries(columns.map(c => [c.key, c.defaultWidth])),
    // Intentionally keyed on serialised column list so it updates if
    // columns change (e.g. metadata columns toggled).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(columns.map(c => c.key + c.defaultWidth))],
  );

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, number>;
        // Merge saved with defaults so new columns get a width.
        const merged = { ...defaults() };
        for (const [k, v] of Object.entries(saved)) {
          if (k in merged) merged[k] = v;
        }
        return merged;
      }
    } catch { /* ignore */ }
    return defaults();
  });

  // Persist on change.
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch { /* ignore */ }
  }, [storageKey, widths]);

  // Ensure new columns added after initial render get a default width.
  useEffect(() => {
    setWidths(prev => {
      const d = defaults();
      let changed = false;
      const next = { ...prev };
      for (const k of Object.keys(d)) {
        if (!(k in next)) { next[k] = d[k]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [defaults]);

  // Track active resize via refs so mousemove/mouseup aren't stale.
  const activeKey = useRef<string | null>(null);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!activeKey.current) return;
    const delta = e.clientX - startX.current;
    const newWidth = Math.max(40, startW.current + delta);
    setWidths(prev => ({ ...prev, [activeKey.current!]: newWidth }));
  }, []);

  const onMouseUp = useCallback(() => {
    activeKey.current = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [onMouseMove]);

  const startResize = useCallback(
    (key: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      activeKey.current = key;
      startX.current = e.clientX;
      startW.current = widths[key] ?? 100;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [widths, onMouseMove, onMouseUp],
  );

  const resetWidths = useCallback(() => {
    setWidths(defaults());
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }, [defaults, storageKey]);

  const totalWidth = Object.values(widths).reduce((s, w) => s + w, 0);
  const tableStyle: React.CSSProperties = {
    tableLayout: 'fixed',
    minWidth: totalWidth,
    width: '100%',
  };

  return { widths, startResize, resetWidths, tableStyle };
}

/**
 * Render a drag handle inside a `<th>`. Sits on the right edge of the cell.
 *
 * ```tsx
 * <th style={{ width: widths.name }}>
 *   Name
 *   <ResizeHandle onMouseDown={(e) => startResize('name', e)} />
 * </th>
 * ```
 */
export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <span
      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
      onMouseDown={onMouseDown}
    />
  );
}
