/**
 * Diagram view modes (#181/#182).
 *
 * The diagram renders the same Cytoscape canvas in one of three modes,
 * selected by a page-level tab and persisted in the URL (`?view=`):
 *
 *   - `structural` — the original entity-name graph (default, unchanged).
 *   - `logical`    — ORM class model derived from `orm.*` (#184/#185).
 *   - `physical`   — DB table model derived from `physical.*` + `constraints[]` (#186/#187).
 *
 * This module is the single source of truth for the mode list, labels and the
 * URL-param ⇄ mode mapping; it is intentionally framework-free so it can be
 * unit-tested in isolation and reused by both the page and the element builder.
 */

export type ViewMode = 'structural' | 'logical' | 'physical';

export const VIEW_MODES: readonly ViewMode[] = ['structural', 'logical', 'physical'] as const;

export const DEFAULT_VIEW_MODE: ViewMode = 'structural';

/** Human labels for the page tabs. */
export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  structural: 'Structural',
  logical: 'Logical (ORM)',
  physical: 'Physical',
};

/**
 * Map a raw `?view=` URL param to a valid {@link ViewMode}.
 * Unknown / missing / malformed values fall back to {@link DEFAULT_VIEW_MODE}
 * so a bad deep-link never breaks the page — it just shows the default tab.
 */
export function parseViewMode(param: string | null | undefined): ViewMode {
  return VIEW_MODES.includes(param as ViewMode) ? (param as ViewMode) : DEFAULT_VIEW_MODE;
}
