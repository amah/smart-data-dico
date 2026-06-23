/**
 * TreeTable — hierarchical sibling of DataTable.
 *
 * Shares DataTable's grammar (standard / metadata column groups, dashed
 * divider, sticky header + first column, drag-to-resize, design tokens)
 * but adds an expand/collapse chevron + indent on a designated tree
 * column. Caller flattens the tree into rows and supplies the toggle
 * callback per row, so TreeTable owns no expansion state of its own —
 * mirrors how DataTable expects rows pre-filtered.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import Icon from './Icon';
import type { ColumnDef, ColumnGroup } from './DataTable.types';

const WIDTH_STORAGE_PREFIX = 'sdd.treeTable.widths.';
const GROUP_ROW_HEIGHT = 28;

// Custom DOM event the hook listens to so a same-tab reset takes effect
// immediately without forcing a remount. The native `storage` event
// only fires across tabs.
const RESET_EVENT = 'sdd.treeTable.widths.reset';

/**
 * Wipe persisted column widths for a TreeTable resizeKey. Use this from
 * a "Reset cols" toolbar button when the user has dragged columns out of
 * shape — the live TreeTable re-reads widths and falls back to each
 * column's declared width.
 */
export function resetTreeTableWidths(resizeKey: string): void {
  try {
    localStorage.removeItem(WIDTH_STORAGE_PREFIX + resizeKey);
    window.dispatchEvent(new CustomEvent(RESET_EVENT, { detail: { resizeKey } }));
  } catch { /* ignore */ }
}

const GROUP_LABEL: Record<ColumnGroup, string> = {
  standard: 'Standard',
  metadata: 'Governance metadata',
};

// Same drag-to-resize hook as DataTable but namespaced under a different
// localStorage prefix so a tree and a flat table on the same key don't
// collide.
function useColumnWidths(resizeKey: string | undefined) {
  const storageKey = resizeKey ? WIDTH_STORAGE_PREFIX + resizeKey : null;
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    if (!storageKey) return {};
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return JSON.parse(raw) as Record<string, number>;
    } catch { /* ignore */ }
    return {};
  });

  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch { /* ignore */ }
  }, [storageKey, widths]);

  // Listen for in-tab reset events fired by resetTreeTableWidths().
  useEffect(() => {
    if (!resizeKey) return;
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ resizeKey: string }>;
      if (ce.detail?.resizeKey === resizeKey) setWidths({});
    };
    window.addEventListener(RESET_EVENT, handler);
    return () => window.removeEventListener(RESET_EVENT, handler);
  }, [resizeKey]);

  const active = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!active.current) return;
    const delta = e.clientX - active.current.startX;
    const next = Math.max(40, active.current.startW + delta);
    setWidths(prev => ({ ...prev, [active.current!.key]: next }));
  }, []);

  const onMouseUp = useCallback(() => {
    active.current = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [onMouseMove]);

  const startResize = useCallback(
    (key: string, currentWidthPx: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      active.current = { key, startX: e.clientX, startW: currentWidthPx };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [onMouseMove, onMouseUp],
  );

  const reset = useCallback(() => setWidths({}), []);

  return { widths, startResize, reset };
}

export interface TreeTableRow<Row> {
  row: Row;
  /** 0 for top-level rows; +1 per descent. Drives the indent on the tree column. */
  indent: number;
  hasChildren: boolean;
  isExpanded: boolean;
  /** No-op when hasChildren is false. */
  toggle: () => void;
}

export interface TreeTableProps<Row> {
  columns: ColumnDef<Row>[];
  /** Pre-flattened, in render order. Caller owns expansion state. */
  rows: TreeTableRow<Row>[];
  getRowKey: (row: Row) => string | number;
  /** Column that owns the chevron + indent. Cell content from `render`/accessor
   *  is wrapped automatically. */
  treeColumnKey: string;

  resizeKey?: string;
  stickyHeader?: boolean;
  stickyFirstColumn?: boolean;
  maxHeight?: number | string;
  attached?: boolean;

  /**
   * Render a sticky "where am I" path bar pinned under the header. Receives
   * the top-most visible row as the user scrolls (null when the first row is
   * at the top). Return falsy to render nothing for that row. Requires a
   * scrolling container (stickyHeader). See CaseTreeTable for usage.
   */
  renderStickyPath?: (topRow: Row | null) => ReactNode;

  emptyMessage?: ReactNode;
  /** Called when a row body is clicked (excluding chevron). */
  onRowClick?: (row: Row) => void;
  className?: string;
}

function accessorValue<Row>(col: ColumnDef<Row>, row: Row): unknown {
  if (col.accessor) return col.accessor(row);
  return (row as Record<string, unknown>)[col.key];
}

function TreeTable<Row>({
  columns,
  rows,
  getRowKey,
  treeColumnKey,
  resizeKey,
  stickyHeader,
  stickyFirstColumn,
  maxHeight,
  attached,
  emptyMessage = 'No rows.',
  onRowClick,
  className = '',
  renderStickyPath,
}: TreeTableProps<Row>) {
  const { widths: columnWidths, startResize } = useColumnWidths(resizeKey);
  const resizable = !!resizeKey;

  // ── Sticky path bar (#case-path): track the top-most visible row so the
  // caller can render a "you are here" breadcrumb pinned under the header.
  // Rows are display:contents, so we measure each row's tree-column cell
  // (a real box, tagged data-ttrowkey) against the header's bottom edge.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [topRow, setTopRow] = useState<Row | null>(null);
  const [headerOffset, setHeaderOffset] = useState(0);

  const rowByKey = useMemo(() => {
    const m = new Map<string, Row>();
    for (const tr of rows) m.set(String(getRowKey(tr.row)), tr.row);
    return m;
  }, [rows, getRowKey]);

  const recomputeTopRow = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || !renderStickyPath) return;
    // At the very top there's nothing scrolled out of view — hide the bar so
    // it doesn't just duplicate the first visible row.
    if (scroller.scrollTop < 4) { setTopRow(null); return; }
    const header = scroller.querySelector('[role="columnheader"]') as HTMLElement | null;
    if (!header) return;
    const headerRect = header.getBoundingClientRect();
    // Distance from the scroll container's top to the header's bottom = where
    // the path bar should pin (the header is itself sticky at the top).
    setHeaderOffset(Math.max(0, headerRect.bottom - scroller.getBoundingClientRect().top));
    const cutoff = headerRect.bottom + 1;
    const cells = scroller.querySelectorAll<HTMLElement>('[data-ttrowkey]');
    let foundKey: string | null = null;
    for (const cell of cells) {
      if (cell.getBoundingClientRect().bottom > cutoff) {
        foundKey = cell.getAttribute('data-ttrowkey');
        break;
      }
    }
    setTopRow(foundKey != null ? rowByKey.get(foundKey) ?? null : null);
  }, [renderStickyPath, rowByKey]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !renderStickyPath) return;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(recomputeTopRow); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    recomputeTopRow();
    return () => { scroller.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [recomputeTopRow, renderStickyPath, rows]);

  const stickyPathContent = renderStickyPath ? renderStickyPath(topRow) : null;

  const initialDragWidth = useCallback((col: ColumnDef<Row>): number => {
    const override = columnWidths[col.key];
    if (override !== undefined) return override;
    if (typeof col.width === 'number') return col.width;
    return 160;
  }, [columnWidths]);

  const standardCols = columns.filter(c => (c.group ?? 'standard') === 'standard');
  const metadataCols = columns.filter(c => (c.group ?? 'standard') === 'metadata');
  const hasMeta = metadataCols.length > 0;

  const colWidth = (c: ColumnDef<Row>) => {
    const override = columnWidths[c.key];
    if (override !== undefined) return `${override}px`;
    return c.width === undefined ? 'minmax(120px, 1fr)' :
      typeof c.width === 'number' ? `${c.width}px` :
      c.width;
  };

  const gridTemplate = [
    ...standardCols.map(colWidth),
    ...metadataCols.map(colWidth),
  ].join(' ');

  const totalCols = columns.length;
  const needsScroll = !!stickyHeader || !!stickyFirstColumn;
  const resolvedMaxHeight = maxHeight ?? (stickyHeader ? '70vh' : undefined);
  const firstDataColKey = standardCols[0]?.key;

  return (
    <div
      ref={scrollRef}
      className={className}
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderTopWidth: attached ? 0 : 1,
        borderRadius: attached ? '0 0 var(--radius-md) var(--radius-md)' : 'var(--radius-md)',
        overflow: needsScroll ? 'auto' : 'hidden',
        maxHeight: resolvedMaxHeight,
      }}
    >
      <div
        role="table"
        style={{
          display: 'grid',
          gridTemplateColumns: gridTemplate,
          fontSize: 'var(--fs-md)',
          color: 'var(--text)',
        }}
      >
        {hasMeta && (
          <div role="row" style={{ display: 'contents' }}>
            <div
              role="columnheader"
              style={{
                gridColumn: `1 / span ${standardCols.length}`,
                padding: '6px 10px',
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-subtle)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: 'var(--bg-subtle)',
                borderBottom: '1px solid var(--border)',
                fontWeight: 600,
                ...(stickyHeader ? { position: 'sticky', top: 0, zIndex: 11 } : null),
              }}
            >
              {GROUP_LABEL.standard}
            </div>
            <div
              role="columnheader"
              style={{
                gridColumn: `${standardCols.length + 1} / span ${metadataCols.length}`,
                padding: '6px 10px',
                fontSize: 'var(--fs-xs)',
                color: 'var(--meta-label)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: 'var(--meta-bg)',
                borderBottom: '1px solid var(--border)',
                borderLeft: '1px dashed var(--meta-border)',
                fontWeight: 600,
                ...(stickyHeader ? { position: 'sticky', top: 0, zIndex: 11 } : null),
              }}
            >
              {GROUP_LABEL.metadata}
            </div>
          </div>
        )}

        <div role="row" style={{ display: 'contents' }}>
          {standardCols.map(col => (
            <ColumnHeaderCell
              key={col.key}
              col={col}
              onStartResize={resizable ? (e) => startResize(col.key, initialDragWidth(col), e) : undefined}
              stickyTop={stickyHeader ? (hasMeta ? GROUP_ROW_HEIGHT : 0) : undefined}
              stickyLeft={stickyFirstColumn && col.key === firstDataColKey}
            />
          ))}
          {metadataCols.map((col, i) => (
            <ColumnHeaderCell
              key={col.key}
              col={col}
              meta
              metaFirst={i === 0}
              onStartResize={resizable ? (e) => startResize(col.key, initialDragWidth(col), e) : undefined}
              stickyTop={stickyHeader ? (hasMeta ? GROUP_ROW_HEIGHT : 0) : undefined}
            />
          ))}
        </div>

        {renderStickyPath && stickyPathContent && (
          <div role="row" style={{ display: 'contents' }}>
            <div
              style={{
                gridColumn: `1 / span ${totalCols}`,
                position: 'sticky',
                top: headerOffset,
                left: stickyFirstColumn ? 0 : undefined,
                zIndex: 9,
                background: 'var(--bg-subtle)',
                borderBottom: '1px solid var(--border)',
                padding: '4px 10px',
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {stickyPathContent}
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <div
            role="row"
            style={{
              gridColumn: `1 / span ${totalCols}`,
              padding: '24px 10px',
              textAlign: 'center',
              color: 'var(--text-subtle)',
              fontSize: 'var(--fs-sm)',
            }}
          >
            {emptyMessage}
          </div>
        ) : (
          rows.map(tr => {
            const rowKey = getRowKey(tr.row);
            const clickable = !!onRowClick;
            return (
              <div
                key={rowKey}
                role="row"
                className="sdd-row"
                onClick={clickable ? () => onRowClick!(tr.row) : undefined}
                style={{ display: 'contents', cursor: clickable ? 'pointer' : undefined }}
              >
                {standardCols.map(col => {
                  const isTree = col.key === treeColumnKey;
                  return (
                    <BodyCell
                      key={col.key}
                      col={col}
                      row={tr.row}
                      treeOps={isTree ? tr : undefined}
                      dataRowKey={isTree ? rowKey : undefined}
                      stickyLeft={stickyFirstColumn && col.key === firstDataColKey}
                    />
                  );
                })}
                {metadataCols.map((col, i) => (
                  <BodyCell
                    key={col.key}
                    col={col}
                    row={tr.row}
                    meta
                    metaFirst={i === 0}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ────────── Sub-components ──────────

interface ColumnHeaderCellProps<Row> {
  col: ColumnDef<Row>;
  meta?: boolean;
  metaFirst?: boolean;
  onStartResize?: (e: React.MouseEvent) => void;
  stickyTop?: number;
  stickyLeft?: boolean;
}

function ColumnHeaderCell<Row>({ col, meta, metaFirst, onStartResize, stickyTop, stickyLeft }: ColumnHeaderCellProps<Row>) {
  const align = col.align ?? 'left';

  return (
    <div
      role="columnheader"
      style={{
        position: (stickyTop !== undefined || stickyLeft) ? 'sticky' : 'relative',
        top: stickyTop,
        left: stickyLeft ? 0 : undefined,
        zIndex: stickyTop !== undefined && stickyLeft ? 13 : stickyTop !== undefined ? 10 : stickyLeft ? 5 : undefined,
        padding: '7px 10px',
        fontSize: 'var(--fs-sm)',
        color: meta ? 'var(--meta-label)' : 'var(--text-muted)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
        background: meta ? 'var(--meta-bg)' : 'var(--bg-subtle)',
        borderBottom: '1px solid var(--border-strong)',
        borderLeft: metaFirst ? '1px dashed var(--meta-border)' : undefined,
        textAlign: align,
        display: 'flex',
        justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
      }}
    >
      <span>{col.header}</span>
      {onStartResize && (
        <span
          role="separator"
          aria-label={`Resize column`}
          onMouseDown={onStartResize}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: 4,
            cursor: 'col-resize',
            background: 'transparent',
          }}
        />
      )}
    </div>
  );
}

interface BodyCellProps<Row> {
  col: ColumnDef<Row>;
  row: Row;
  meta?: boolean;
  metaFirst?: boolean;
  stickyLeft?: boolean;
  /** When set, this cell is the tree column — chevron + indent are added. */
  treeOps?: TreeTableRow<Row>;
  /** Row key stamped as data-ttrowkey on the tree cell, for sticky-path tracking. */
  dataRowKey?: string | number;
}

function BodyCell<Row>({ col, row, meta, metaFirst, stickyLeft, treeOps, dataRowKey }: BodyCellProps<Row>) {
  const align = col.align ?? 'left';
  const value = accessorValue(col, row);
  const content: ReactNode = col.render ? col.render(row) : (value as ReactNode);

  const cellStyle: CSSProperties = {
    ...(stickyLeft
      ? { position: 'sticky', left: 0, zIndex: 3, background: 'var(--bg-raised)' }
      : null),
    padding: '0 10px',
    minHeight: 'var(--row-height, 36px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
    fontSize: 'var(--fs-md)',
    color: 'var(--text)',
    borderBottom: '1px solid var(--border)',
    borderLeft: metaFirst ? '1px dashed var(--meta-border)' : undefined,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  };

  if (treeOps) {
    return (
      <div role="cell" data-ttrowkey={dataRowKey} className={`sdd-cell ${col.mono ? 'mono' : ''}`} style={cellStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            paddingLeft: `${treeOps.indent * 0.75}rem`,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            width: '100%',
          }}
        >
          {treeOps.hasChildren ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); treeOps.toggle(); }}
              aria-label={treeOps.isExpanded ? 'Collapse' : 'Expand'}
              style={{
                width: 20,
                height: 20,
                padding: 0,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: treeOps.isExpanded ? 'rotate(90deg)' : undefined,
                transition: 'transform var(--dur-fast)',
                flexShrink: 0,
              }}
            >
              <Icon name="chevronR" size={12} />
            </button>
          ) : (
            <span style={{ width: 20, flexShrink: 0 }} />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {content}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      role="cell"
      className={`sdd-cell ${col.mono ? 'mono' : ''}`}
      data-meta={meta ? '1' : undefined}
      style={cellStyle}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
        {content}
      </span>
    </div>
  );
}

export default TreeTable;
