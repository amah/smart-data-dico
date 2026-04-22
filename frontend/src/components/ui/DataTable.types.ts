/**
 * Shared types for DataTable + ColumnChooser — extracted so the
 * chooser can describe columns without pulling in the table module.
 */

import type { ReactNode } from 'react';

export type ColumnGroup = 'standard' | 'metadata';

export type SortDir = 'asc' | 'desc';

export interface ColumnDef<Row> {
  key: string;
  header: string;
  /** Which side of the standard/metadata split this column lives on. Defaults to 'standard'. */
  group?: ColumnGroup;
  /** CSS width — number (px) or explicit string (e.g. '1fr', '160px'). */
  width?: number | string;
  /** Render mono font in the cell. Header stays sans. */
  mono?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  /** Custom cell renderer. If absent, the accessor's return value is rendered verbatim. */
  render?: (row: Row) => ReactNode;
  /** Value used for filtering + sorting. If omitted, falls back to `row[key]`. */
  accessor?: (row: Row) => string | number | boolean | null | undefined;
  /** Horizontal alignment for the cell + header. Defaults 'left'. */
  align?: 'left' | 'right' | 'center';
}
