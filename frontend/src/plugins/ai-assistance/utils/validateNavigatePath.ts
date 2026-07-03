/**
 * validateNavigatePath
 *
 * The AI agent's `navigateTo` tool returns an arbitrary path string; the
 * model occasionally hallucinates singular forms (`/package/foo/entity/Bar`)
 * that don't exist in the React Router config and would route to the
 * generic 404 page with no signal back to the AI for self-correction.
 *
 * This helper checks the proposed path against the route patterns
 * registered in `frontend/src/App.tsx` BEFORE calling `navigate(path)`.
 * On mismatch, the caller suppresses navigation and surfaces an error
 * into the tool output the AI sees on its next turn.
 *
 * Drift note: the patterns array MUST be kept in lock-step with
 * `frontend/src/App.tsx`. A small unit test asserts that every
 * top-level Route path in App.tsx appears here.
 */

import { matchPath } from 'react-router-dom';

/**
 * Flat list of valid route patterns, mirroring the JSX <Route> tree in
 * frontend/src/App.tsx. Wildcards are written as `*` (matches any
 * subpath). Params are written as `:name` (matches a single segment).
 */
export const ROUTE_PATTERNS: readonly string[] = [
  '/login',
  '/register',
  '/forgot-password',
  '/',
  '/create',
  '/dictionaries',
  '/packages',
  '/packages/*',
  '/cases',
  '/cases/create',
  '/cases/:id',
  '/cases/:id/edit',
  '/perspectives',
  '/perspectives/*',
  '/diagram',
  '/diagram/:service',
  '/diagram/:service/:entity',
  '/import-export',
  '/quality',
  '/stereotypes',
  '/search',
  '/entities/flat',
  '/flat/packages',
  '/flat/entities',
  '/flat/attributes',
  '/rules',
  '/integrity',
  '/diff/logical',
  '/diff/physical',
  '/commands',
  '/version/save',
  '/version/history',
  '/version/workspaces',
  '/version/merge',
  '/version/commit',
  '/profile',
  '/settings',
  '/types',
  '/element-styles',
  '/design-system',
  '/design/tokens',
  '/design/primitives',
];

export interface NavigateValidationResult {
  valid: boolean;
  reason?: string;
  /** Top-level roots (`/cases`, `/packages`, …) for the AI to retry with. */
  knownRoots?: string[];
}

/**
 * Validate that `path` matches a registered React Router route. Strips
 * query/hash before matching. Returns `{ valid: true }` on success;
 * otherwise returns the list of top-level roots so the caller can
 * surface a hint back to the AI.
 */
export function validateNavigatePath(path: string): NavigateValidationResult {
  if (typeof path !== 'string' || path.length === 0 || path[0] !== '/') {
    return {
      valid: false,
      reason: `navigate path must be an absolute URL beginning with "/", received: ${JSON.stringify(path)}`,
      knownRoots: topLevelRoots(),
    };
  }
  const clean = path.split('?')[0].split('#')[0];
  for (const pattern of ROUTE_PATTERNS) {
    if (matchPath(pattern, clean)) {
      return { valid: true };
    }
  }
  return {
    valid: false,
    reason: `Page not found at "${path}". Common drift: singular vs plural (e.g. "/package/foo" → "/packages/foo", "/entity/Bar" → "/packages/<pkg>/entities/Bar").`,
    knownRoots: topLevelRoots(),
  };
}

function topLevelRoots(): string[] {
  const roots = new Set<string>();
  for (const p of ROUTE_PATTERNS) {
    if (p === '/') { roots.add('/'); continue; }
    const root = '/' + p.split('/').filter(Boolean)[0];
    roots.add(root);
  }
  return [...roots].sort();
}
