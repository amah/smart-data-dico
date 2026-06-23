/**
 * DataTable — the load-bearing table component for the redesign.
 *
 * Grammar (see /design-system → DataTable):
 *   - Columns split into `standard` and `metadata` groups.
 *   - Dashed vertical divider at the group boundary, --meta-bg tint
 *     across the metadata side.
 *   - Group headers ("Standard" / "Governance metadata") above the
 *     column headers, rendered in --meta-label uppercase fs-xs.
 *   - Column header row: uppercase fs-sm muted, sort caret on hover
 *     or when active.
 *   - Optional filter row below the headers.
 *   - Row height = var(--row-height) (driven by the shell's density
 *     preference; Phase 3 will wire that to a setting).
 *   - Hover: --bg-hover. Selected: --bg-active + 2px accent left
 *     stripe. Both live in tokens.css so the whole row reacts to
 *     hover, not each cell independently.
 *
 * The component is *uncontrolled by default* (internal sort / filters
 * / visible-column state) so callers can get a working table with
 * just `columns` + `rows`. Every piece of state has a controlled
 * escape hatch via props for Phase 4 pages that want to persist
 * state in Redux.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Icon from './Icon';
import Button from './Button';
import type { ColumnDef, ColumnGroup, SortDir } from './DataTable.types';

type RowKey = string | number;

const WIDTH_STORAGE_PREFIX = 'sdd.dataTable.widths.';

// Approximate rendered height of the group row, used to compute the
// sticky `top` offset for the column-header row beneath it.
const GROUP_ROW_HEIGHT = 28;

/**
 * Tracks per-column drag-resized widths, persisted in localStorage per
 * resizeKey. Returns the width override (pixels) for a column, or
 * undefined — callers fall back to the column's declared width when no
 * override exists.
 */
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

  return { widths, startResize };
}

const GROUP_LABEL: Record<ColumnGroup, string> = {
  standard: 'Standard',
  metadata: 'Governance metadata',
};

function accessorValue<Row>(col: ColumnDef<Row>, row: Row): unknown {
  if (col.accessor) return col.accessor(row);
  return (row as Record<string, unknown>)[col.key];
}

function compare(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined || a === '';
  const bNull = b === null || b === undefined || b === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

export interface DataTableProps<Row> {
  columns: ColumnDef<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string | number;

  visibleColumns?: Set<string>;
  onVisibleColumnsChange?: (next: Set<string>) => void;

  sort?: { key: string; dir: SortDir } | null;
  onSortChange?: (next: { key: string; dir: SortDir } | null) => void;

  filters?: Record<string, string>;
  onFiltersChange?: (next: Record<string, string>) => void;

  selectedRow?: RowKey | null;
  onSelectRow?: (key: RowKey) => void;

  /**
   * Controlled multi-select. When `selection` is provided the table
   * renders a leading checkbox column + tri-state header checkbox.
   * The set of keys is the caller's source of truth; the table only
   * produces change events.
   *
   * Shift-click on a row checkbox extends from the last-toggled row
   * (inclusive) using the currently-visible processed order.
   */
  selection?: Set<RowKey>;
  onSelectionChange?: (next: Set<RowKey>) => void;

  showFilterRow?: boolean;
  onRowClick?: (row: Row) => void;
  emptyMessage?: ReactNode;

  /**
   * Optional per-row action column appended at the right edge (after
   * metadata). The returned node is rendered inside a cell that
   * stops click propagation so button clicks don't fire the row's
   * onRowClick. Not sortable / filterable / resizable.
   */
  rowActions?: (row: Row) => ReactNode;
  /** Width of the trailing actions column. Defaults to 80px. */
  rowActionsWidth?: number;

  /**
   * Enables drag-to-resize on standard + metadata column headers.
   * Widths are persisted in localStorage under this key so they survive
   * reload. Selection, filter, and row-action columns are excluded from
   * resize.
   */
  resizeKey?: string;

  /**
   * Sticky top header — every header row stays pinned while the body
   * scrolls. Implies the container becomes a scroll viewport.
   */
  stickyHeader?: boolean;
  /**
   * Sticky leftmost column — the leftmost visible data column (and its
   * selection checkbox if selectable) stays pinned during horizontal
   * scroll.
   */
  stickyFirstColumn?: boolean;
  /**
   * Caps the vertical size of the DataTable when a sticky header or
   * explicit scroll is desired. Accepts a CSS length; defaults to
   * '70vh' when stickyHeader is on and no value is provided.
   */
  maxHeight?: number | string;

  /** No top border / top radius — for wrapping under a Toolbar. */
  attached?: boolean;
  className?: string;
}

function DataTable<Row>({
  columns,
  rows,
  getRowKey,
  visibleColumns: visibleProp,
  onVisibleColumnsChange,
  sort: sortProp,
  onSortChange,
  filters: filtersProp,
  onFiltersChange,
  selectedRow,
  onSelectRow,
  selection,
  onSelectionChange,
  showFilterRow,
  onRowClick,
  emptyMessage = 'No rows.',
  rowActions,
  rowActionsWidth = 80,
  resizeKey,
  stickyHeader,
  stickyFirstColumn,
  maxHeight,
  attached,
  className = '',
}: DataTableProps<Row>) {
  const { widths: columnWidths, startResize } = useColumnWidths(resizeKey);
  const resizable = !!resizeKey;

  // Start-width for a drag-resize: the override if we have one, else a
  // sensible default derived from the column's declared width. On the
  // first drag after mount minmax() columns snap to a fixed pixel size
  // — that's the trade-off for avoiding a measure/re-render cycle.
  const initialDragWidth = useCallback((col: ColumnDef<Row>): number => {
    const override = columnWidths[col.key];
    if (override !== undefined) return override;
    if (typeof col.width === 'number') return col.width;
    return 160; // reasonable default for minmax(120, 1fr) etc.
  }, [columnWidths]);
  const [visibleState, setVisibleState] = useState<Set<string>>(
    () => new Set(columns.map(c => c.key)),
  );
  const [sortState, setSortState] = useState<{ key: string; dir: SortDir } | null>(null);
  const [filterState, setFilterState] = useState<Record<string, string>>({});

  const visible = visibleProp ?? visibleState;
  const setVisible = onVisibleColumnsChange ?? setVisibleState;
  void setVisible; // only used by caller-controlled mode today; retained for future toolbar plumbing
  const sort = sortProp !== undefined ? sortProp : sortState;
  const setSort = onSortChange ?? setSortState;
  const filters = filtersProp ?? filterState;
  const setFilters = onFiltersChange ?? setFilterState;

  const activeColumns = columns.filter(c => visible.has(c.key));
  const standardCols = activeColumns.filter(c => (c.group ?? 'standard') === 'standard');
  const metadataCols = activeColumns.filter(c => (c.group ?? 'standard') === 'metadata');
  const hasMeta = metadataCols.length > 0;

  const processedRows = useMemo(() => {
    const filterEntries = Object.entries(filters).filter(([, v]) => v && v.length > 0);
    let out = rows;
    if (filterEntries.length > 0) {
      out = out.filter(row =>
        filterEntries.every(([key, needle]) => {
          const col = columns.find(c => c.key === key);
          if (!col) return true;
          const v = accessorValue(col, row);
          if (v === null || v === undefined) return false;
          return String(v).toLowerCase().includes(needle.toLowerCase());
        }),
      );
    }
    if (sort) {
      const col = columns.find(c => c.key === sort.key);
      if (col) {
        out = [...out].sort((a, b) => {
          const cmp = compare(accessorValue(col, a), accessorValue(col, b));
          return sort.dir === 'desc' ? -cmp : cmp;
        });
      }
    }
    return out;
  }, [rows, columns, filters, sort]);

  const handleHeaderClick = (col: ColumnDef<Row>) => {
    if (!col.sortable) return;
    if (!sort || sort.key !== col.key) setSort({ key: col.key, dir: 'asc' });
    else if (sort.dir === 'asc') setSort({ key: col.key, dir: 'desc' });
    else setSort(null);
  };

  const setFilter = (key: string, value: string) => {
    const next = { ...filters };
    if (value) next[key] = value;
    else delete next[key];
    setFilters(next);
  };

  const clearAllFilters = () => setFilters({});
  const anyFilter = Object.values(filters).some(v => v && v.length > 0);

  const colWidth = (c: ColumnDef<Row>) => {
    const override = columnWidths[c.key];
    if (override !== undefined) return `${override}px`;
    return c.width === undefined ? 'minmax(120px, 1fr)' :
      typeof c.width === 'number' ? `${c.width}px` :
      c.width;
  };

  const selectable = selection !== undefined && onSelectionChange !== undefined;
  const hasActions = !!rowActions;
  const selectionColWidth = '36px';
  const standardSpanStart = selectable ? 2 : 1;
  const totalCols = activeColumns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0);

  const gridTemplate = [
    ...(selectable ? [selectionColWidth] : []),
    ...standardCols.map(colWidth),
    ...metadataCols.map(colWidth),
    ...(hasActions ? [`${rowActionsWidth}px`] : []),
  ].join(' ');

  // Selection state derivations
  const visibleKeys = processedRows.map(getRowKey);
  const selectedVisibleCount = selectable
    ? visibleKeys.reduce<number>((n, k) => n + (selection!.has(k) ? 1 : 0), 0)
    : 0;
  const allVisibleSelected = selectable && visibleKeys.length > 0 && selectedVisibleCount === visibleKeys.length;
  const someVisibleSelected = selectable && selectedVisibleCount > 0 && !allVisibleSelected;

  const lastToggledKey = useRef<RowKey | null>(null);

  const toggleOne = (key: RowKey, shiftKey: boolean) => {
    if (!selectable) return;
    const next = new Set(selection!);
    // Shift-click: extend range from the last-toggled key through `key`
    // using the current visible order. Otherwise toggle just this row.
    if (shiftKey && lastToggledKey.current !== null && lastToggledKey.current !== key) {
      const i = visibleKeys.indexOf(lastToggledKey.current);
      const j = visibleKeys.indexOf(key);
      if (i >= 0 && j >= 0) {
        const [lo, hi] = i < j ? [i, j] : [j, i];
        // Anchor's state decides add vs remove so the range follows the
        // intent of the first click in the pair.
        const add = selection!.has(lastToggledKey.current);
        for (let k = lo; k <= hi; k++) {
          if (add) next.add(visibleKeys[k]);
          else next.delete(visibleKeys[k]);
        }
        onSelectionChange!(next);
        lastToggledKey.current = key;
        return;
      }
    }
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange!(next);
    lastToggledKey.current = key;
  };

  const toggleAllVisible = () => {
    if (!selectable) return;
    const next = new Set(selection!);
    if (allVisibleSelected) {
      for (const k of visibleKeys) next.delete(k);
    } else {
      for (const k of visibleKeys) next.add(k);
    }
    onSelectionChange!(next);
  };

  // When sticky features are on the outer container becomes a scroll
  // viewport; `overflow: hidden` would clip sticky cells and defeat the
  // feature, so we switch to `overflow: auto` and cap the height.
  const needsScroll = !!stickyHeader || !!stickyFirstColumn;
  const resolvedMaxHeight = maxHeight ?? (stickyHeader ? '70vh' : undefined);
  const firstDataCol = standardCols[0];
  const firstDataColKey = firstDataCol?.key;

  return (
    <div
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
            {selectable && (
              <div
                role="columnheader"
                style={{
                  background: 'var(--bg-subtle)',
                  borderBottom: '1px solid var(--border)',
                  ...(stickyHeader ? { position: 'sticky', top: 0, zIndex: 12 } : null),
                }}
              />
            )}
            <div
              role="columnheader"
              style={{
                gridColumn: `${standardSpanStart} / span ${standardCols.length}`,
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
                gridColumn: `${standardSpanStart + standardCols.length} / span ${metadataCols.length}`,
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
            {hasActions && (
              <div
                role="columnheader"
                style={{
                  background: 'var(--bg-subtle)',
                  borderBottom: '1px solid var(--border)',
                  ...(stickyHeader ? { position: 'sticky', top: 0, zIndex: 11 } : null),
                }}
              />
            )}
          </div>
        )}

        <div role="row" style={{ display: 'contents' }}>
          {selectable && (
            <SelectionHeaderCell
              checked={allVisibleSelected}
              indeterminate={someVisibleSelected}
              onToggle={toggleAllVisible}
              disabled={visibleKeys.length === 0}
              stickyTop={stickyHeader ? (hasMeta ? GROUP_ROW_HEIGHT : 0) : undefined}
              stickyLeft={stickyFirstColumn}
            />
          )}
          {standardCols.map(col => (
            <ColumnHeaderCell
              key={col.key}
              col={col}
              sort={sort}
              onClick={() => handleHeaderClick(col)}
              onStartResize={resizable ? (e) => startResize(col.key, initialDragWidth(col), e) : undefined}
              stickyTop={stickyHeader ? (hasMeta ? GROUP_ROW_HEIGHT : 0) : undefined}
              stickyLeft={stickyFirstColumn && !selectable && col.key === firstDataColKey}
              filter={showFilterRow ? { value: filters[col.key] ?? '', onChange: v => setFilter(col.key, v) } : undefined}
            />
          ))}
          {metadataCols.map((col, i) => (
            <ColumnHeaderCell
              key={col.key}
              col={col}
              sort={sort}
              onClick={() => handleHeaderClick(col)}
              meta
              metaFirst={i === 0}
              onStartResize={resizable ? (e) => startResize(col.key, initialDragWidth(col), e) : undefined}
              stickyTop={stickyHeader ? (hasMeta ? GROUP_ROW_HEIGHT : 0) : undefined}
              filter={showFilterRow ? { value: filters[col.key] ?? '', onChange: v => setFilter(col.key, v) } : undefined}
            />
          ))}
          {hasActions && (
            <div
              role="columnheader"
              style={{
                padding: '7px 10px',
                background: 'var(--bg-subtle)',
                borderBottom: '1px solid var(--border-strong)',
              }}
            />
          )}
        </div>

        {processedRows.length === 0 ? (
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
          processedRows.map(row => {
            const rowKey = getRowKey(row);
            const inMultiSelect = selectable && selection!.has(rowKey);
            // Highlight the row when it's either the focused single-select
            // target or part of the bulk-selection set. Both share the
            // same visual (bg-active + accent stripe) — they can't appear
            // together in a way that produces ambiguity.
            const isSelected = selectedRow === rowKey || inMultiSelect;
            const clickable = Boolean(onSelectRow || onRowClick);
            const handleClick = () => {
              if (onSelectRow) onSelectRow(rowKey);
              if (onRowClick) onRowClick(row);
            };
            return (
              <div
                key={rowKey}
                role="row"
                className="sdd-row"
                // #193 — row-level key so useHighlightOnArrival can locate +
                // flash a row (.sdd-flash > .sdd-cell). DataTable has no
                // sticky-path scan, so stamping the display:contents row is safe.
                data-ttrowkey={String(rowKey)}
                data-selected={isSelected ? '1' : undefined}
                onClick={clickable ? handleClick : undefined}
                style={{ display: 'contents', cursor: clickable ? 'pointer' : undefined }}
              >
                {selectable && (
                  <SelectionCell
                    checked={inMultiSelect!}
                    onToggle={(shift) => toggleOne(rowKey, shift)}
                    stickyLeft={stickyFirstColumn}
                  />
                )}
                {standardCols.map(col => (
                  <Cell
                    key={col.key}
                    col={col}
                    row={row}
                    stickyLeft={stickyFirstColumn && !selectable && col.key === firstDataColKey}
                  />
                ))}
                {metadataCols.map((col, i) => (
                  <Cell key={col.key} col={col} row={row} meta metaFirst={i === 0} />
                ))}
                {hasActions && (
                  <div
                    role="cell"
                    className="sdd-cell"
                    // Stop propagation so the trailing buttons don't also
                    // trigger onRowClick (e.g. opening the side panel).
                    onClick={e => e.stopPropagation()}
                    style={{
                      padding: '0 6px',
                      height: 'var(--row-height, 36px)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: 4,
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {rowActions!(row)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {showFilterRow && anyFilter && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '4px 8px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-subtle)',
          }}
        >
          <Button variant="ghost" size="sm" icon="close" onClick={clearAllFilters}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}

// ────────── Sub-components ──────────

interface ColumnHeaderCellProps<Row> {
  col: ColumnDef<Row>;
  sort: { key: string; dir: SortDir } | null | undefined;
  onClick: () => void;
  meta?: boolean;
  metaFirst?: boolean;
  /** Starts a drag-resize from the trailing handle. */
  onStartResize?: (e: React.MouseEvent) => void;
  /** `top` offset when this row is sticky. Undefined ⇒ not sticky. */
  stickyTop?: number;
  /** `left: 0` sticky for the leftmost data column. */
  stickyLeft?: boolean;
  /** Excel-style inline filter (rendered in this cell when set). */
  filter?: { value: string; onChange: (v: string) => void };
}

function ColumnHeaderCell<Row>({ col, sort, onClick, meta, metaFirst, onStartResize, stickyTop, stickyLeft, filter }: ColumnHeaderCellProps<Row>) {
  const active = sort && sort.key === col.key;
  const align = col.align ?? 'left';
  const hasFilter = !!filter && !!col.filterable;

  return (
    <div
      role="columnheader"
      aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      style={{
        position: (stickyTop !== undefined || stickyLeft) ? 'sticky' : 'relative',
        top: stickyTop,
        left: stickyLeft ? 0 : undefined,
        zIndex: stickyTop !== undefined && stickyLeft ? 13 : stickyTop !== undefined ? 10 : stickyLeft ? 5 : undefined,
        padding: hasFilter ? '4px 10px 4px' : '7px 10px',
        fontSize: 'var(--fs-sm)',
        color: meta ? 'var(--meta-label)' : 'var(--text-muted)',
        background: meta ? 'var(--meta-bg)' : 'var(--bg-subtle)',
        borderBottom: '1px solid var(--border-strong)',
        borderLeft: metaFirst ? '1px dashed var(--meta-border)' : undefined,
        textAlign: align,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div
        onClick={col.sortable ? onClick : undefined}
        style={{
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          cursor: col.sortable ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
          gap: 4,
          whiteSpace: 'nowrap',
        }}
      >
        <span>{col.header}</span>
        {col.sortable && (
          <span
            aria-hidden
            style={{
              opacity: active ? 1 : 0.3,
              display: 'inline-flex',
              color: active ? 'var(--accent)' : 'currentColor',
              transform: active && sort!.dir === 'desc' ? 'rotate(180deg)' : undefined,
              transition: 'transform var(--dur-fast), opacity var(--dur-fast)',
            }}
          >
            <Icon name="chevron" size={10} stroke={2} />
          </span>
        )}
      </div>
      {hasFilter && (
        <input
          type="text"
          placeholder="filter…"
          value={filter!.value}
          onChange={e => filter!.onChange(e.target.value)}
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%',
            height: 20,
            padding: '0 6px',
            fontSize: 'var(--fs-xs)',
            fontFamily: 'inherit',
            background: 'var(--bg-raised)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            outline: 'none',
            textTransform: 'none',
            letterSpacing: 'normal',
            fontWeight: 400,
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        />
      )}
      {onStartResize && (
        <span
          role="separator"
          aria-label={`Resize ${col.header} column`}
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

interface CellProps<Row> {
  col: ColumnDef<Row>;
  row: Row;
  meta?: boolean;
  metaFirst?: boolean;
  stickyLeft?: boolean;
}

function Cell<Row>({ col, row, meta, metaFirst, stickyLeft }: CellProps<Row>) {
  const align = col.align ?? 'left';
  const value = accessorValue(col, row);
  const content = col.render ? col.render(row) : (value as ReactNode);

  return (
    <div
      role="cell"
      className={`sdd-cell ${col.mono ? 'mono' : ''}`}
      data-meta={meta ? '1' : undefined}
      style={{
        ...(stickyLeft
          ? { position: 'sticky', left: 0, zIndex: 3, background: 'var(--bg-raised)' }
          : null),
        padding: '0 10px',
        height: 'var(--row-height, 36px)',
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
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
        {content as ReactNode}
      </span>
    </div>
  );
}

// ────────── Selection cells ──────────
//
// A native <input type="checkbox"> is wrapped in a role="cell" so it
// participates in the grid's row + hover semantics. `stopPropagation`
// on the click keeps the row's own onClick (side-panel select, etc.)
// from firing when the user is checking the box.

interface SelectionHeaderCellProps {
  checked: boolean;
  indeterminate: boolean;
  onToggle: () => void;
  disabled: boolean;
  stickyTop?: number;
  stickyLeft?: boolean;
}

function SelectionHeaderCell({ checked, indeterminate, onToggle, disabled, stickyTop, stickyLeft }: SelectionHeaderCellProps) {
  const sticky = stickyTop !== undefined || stickyLeft;
  return (
    <div
      role="columnheader"
      style={{
        ...(sticky
          ? {
              position: 'sticky',
              top: stickyTop,
              left: stickyLeft ? 0 : undefined,
              zIndex: stickyTop !== undefined && stickyLeft ? 14 : stickyTop !== undefined ? 10 : 5,
            }
          : null),
        padding: '7px 10px',
        background: 'var(--bg-subtle)',
        borderBottom: '1px solid var(--border-strong)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <input
        type="checkbox"
        aria-label="Select all visible rows"
        checked={checked}
        ref={el => { if (el) el.indeterminate = indeterminate; }}
        disabled={disabled}
        onChange={onToggle}
        onClick={e => e.stopPropagation()}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer', accentColor: 'var(--accent)' }}
      />
    </div>
  );
}

interface SelectionCellProps {
  checked: boolean;
  onToggle: (shiftKey: boolean) => void;
  stickyLeft?: boolean;
}

function SelectionCell({ checked, onToggle, stickyLeft }: SelectionCellProps) {
  return (
    <div
      role="cell"
      className="sdd-cell"
      style={{
        ...(stickyLeft
          ? { position: 'sticky', left: 0, zIndex: 3, background: 'var(--bg-raised)' }
          : null),
        padding: '0 10px',
        height: 'var(--row-height, 36px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderBottom: '1px solid var(--border)',
      }}
      onClick={e => e.stopPropagation()}
    >
      <input
        type="checkbox"
        aria-label="Select row"
        checked={checked}
        onChange={() => { /* handled in onClick so we can read shiftKey */ }}
        onClick={e => { e.stopPropagation(); onToggle(e.shiftKey); }}
        style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
      />
    </div>
  );
}

export default DataTable;
