/**
 * routesManifest — canonical list of frontend URL templates that the AI
 * agent (and MCP clients) can discover via the `listRoutes` tool.
 *
 * Purpose: the AI's `navigateTo` tool was hallucinating singular forms
 * (`/package/foo/entity/Bar`) that fail the frontend's
 * validateNavigatePath guard. Instead of bloating the system prompt with
 * the full URL taxonomy, expose it as a tool the model can call when
 * uncertain — turning navigation into a lookup, not a guess.
 *
 * Drift note: the frontend keeps its own ROUTE_PATTERNS list in
 * `frontend/src/plugins/ai-assistance/utils/validateNavigatePath.ts` —
 * THAT is authoritative (the validator runs against it). This manifest
 * is a curated subset with human-readable descriptions for the AI;
 * keep entries in sync when adding new top-level pages.
 */

export interface RouteEntry {
  /** React Router pattern with `:param` and `*` wildcards. */
  pattern: string;
  /** One-line human description for the AI. */
  description: string;
  /** Optional concrete example to anchor the model. */
  example?: string;
}

export const KNOWN_ROUTES: readonly RouteEntry[] = [
  { pattern: '/',                                                              description: 'Home — dashboard with the package list and quality/integrity tiles.', example: '/' },
  { pattern: '/packages',                                                      description: 'All packages.', example: '/packages' },
  { pattern: '/packages/:packageName',                                         description: 'Package detail (entities, relationships, rules).', example: '/packages/order-service' },
  { pattern: '/packages/:packageName/entities/:entityName',                    description: 'Entity detail page (attributes, relationships, metadata, rules).', example: '/packages/order-service/entities/Order' },
  { pattern: '/packages/:packageName/entities/:entityName/attributes/:attr',   description: 'Attribute detail.', example: '/packages/order-service/entities/Order/attributes/total' },
  { pattern: '/packages/:packageName/entities/:entityName/relationships/create', description: 'New-relationship editor for an entity.', example: '/packages/order-service/entities/Order/relationships/create' },
  { pattern: '/diagram',                                                       description: 'Organisation diagram (all packages, all entities).' },
  { pattern: '/visualization',                                                 description: 'Visualization landing.' },
  { pattern: '/visualization/:packageName',                                    description: 'Package-level entity graph.' },
  { pattern: '/visualization/:packageName/:entityName',                        description: 'Entity-centric graph.' },
  { pattern: '/cases',                                                         description: 'Cases list (formerly Perspectives, #121).' },
  { pattern: '/cases/create',                                                  description: 'New case form.' },
  { pattern: '/cases/:id',                                                     description: 'Case detail.' },
  { pattern: '/cases/:id/edit',                                                description: 'Case editor.' },
  { pattern: '/integrity',                                                     description: 'Integrity dashboard — unified validations + constraints + rules (#85 R5).' },
  { pattern: '/quality',                                                       description: 'Quality dashboard.' },
  { pattern: '/stereotypes',                                                   description: 'Stereotype management (metadata schemas per element type).' },
  { pattern: '/types',                                                         description: 'Derived data types (#107).' },
  { pattern: '/diff/logical',                                                  description: 'Logical model diff between commits.' },
  { pattern: '/diff/physical',                                                 description: 'Physical model diff.' },
  { pattern: '/search',                                                        description: 'Cross-package search.' },
  { pattern: '/entities/flat',                                                 description: 'Flat entity table (sortable, filterable).' },
  { pattern: '/flat/packages',                                                 description: 'Flat package table.' },
  { pattern: '/flat/entities',                                                 description: 'Flat entity table (alias).' },
  { pattern: '/flat/attributes',                                               description: 'Flat attribute table.' },
  { pattern: '/rules',                                                         description: 'Rule browser (back-compat; Integrity is the new home).' },
  { pattern: '/import-export',                                                 description: 'Import/export tools.' },
  { pattern: '/version/history',                                               description: 'Git commit history.' },
  { pattern: '/version/save',                                                  description: 'Save & publish (commit current changes).' },
  { pattern: '/version/workspaces',                                            description: 'Workspace manager.' },
  { pattern: '/version/merge',                                                 description: 'Merge workspaces.' },
  { pattern: '/version/commit',                                                description: 'Commit changes view.' },
  { pattern: '/commands',                                                      description: 'Commands debug page (#163 phase 6).' },
  { pattern: '/profile',                                                       description: 'User profile.' },
  { pattern: '/settings',                                                      description: 'App settings, AI preferences, tool auto-approve policy.' },
  { pattern: '/design-system',                                                 description: 'Living style guide — tokens + every ui/* primitive.' },
];
