/**
 * DI Injection Tokens
 *
 * Domain-specific tokens for service resolution in the microkernel.
 * Framework tokens (STORE_MANAGER_TOKEN, SHELL_TOKEN, etc.) are imported
 * directly from their respective @hamak packages.
 */

// Domain service tokens
export const DICTIONARY_SERVICE_TOKEN = Symbol('DictionaryService');
export const ENTITY_SERVICE_TOKEN = Symbol('EntityService');
export const MICROSERVICE_SERVICE_TOKEN = Symbol('MicroserviceService');
export const DIAGRAM_SERVICE_TOKEN = Symbol('DiagramService');
export const VERSION_SERVICE_TOKEN = Symbol('VersionService');
export const SEARCH_SERVICE_TOKEN = Symbol('SearchService');
export const AUTH_SERVICE_TOKEN = Symbol('AuthService');

/**
 * DI token for the canonical Store FS facade.
 *
 * Provided by `storeFsPlugin` during `initialize` as a lazy Proxy; the
 * underlying `StoreFileSystemFacade<RootState>` is constructed during
 * `activate` after the framework-singleton `FileSystemAdapter` is resolvable.
 * The facade reads from `state.fs` — the slice that `createStorePlugin`
 * from `@hamak/ui-store-impl` registers automatically (see
 * frontend/node_modules/@hamak/ui-store-impl/dist/plugin/store-plugin-factory.js:18
 * and :79). Domain services consume this token to read/write workspace files
 * through Redux instead of axios.
 */
export const STORE_FS_TOKEN = Symbol('StoreFs');

/**
 * DI token for the StereotypeService.
 *
 * First domain service token from #155's catalog to be both declared AND
 * resolved (the legacy `DICTIONARY_SERVICE_TOKEN` etc. above are declared
 * but not yet wired). Pattern A facade per #155 — reads via Store FS
 * selectors, writes via the legacy REST shim while the framework's
 * JSON-vs-YAML round-trip gap (Risk 1) is unresolved.
 */
export const STEREOTYPE_SERVICE_TOKEN = Symbol('StereotypeService');

/**
 * DI token for the IntegrityService.
 *
 * Pattern B per #155 catalog: a REST wrapper around the computed
 * `GET /api/integrity` endpoint (validation + constraints + rules — see
 * CLAUDE.md "Validation / Constraint / Rule" trinity). Owned by the
 * `data-dictionary` plugin; constructed and provided in
 * `dataDictionaryPlugin.initialize`.
 */
export const INTEGRITY_SERVICE_TOKEN = Symbol('IntegrityService');

/**
 * DI token for the DiffService.
 *
 * Pattern B per #155 catalog: REST wrapper around the computed
 * `/api/diff/logical`, `/api/diff/physical`, `/api/diff/physical/all`, and
 * `/api/services/:svc/physical-config` endpoints. Owned by the
 * `data-dictionary` plugin; constructed and provided eagerly in
 * `dataDictionaryPlugin.initialize` (no kernel dependencies — same shape
 * as INTEGRITY_SERVICE_TOKEN).
 */
export const DIFF_SERVICE_TOKEN = Symbol('DiffService');

/**
 * DI token for the ImportExportService.
 *
 * Pattern B per #155 catalog: a REST wrapper around the import / export /
 * quality computed endpoints (`/api/import/**`, `/api/export/**`,
 * `/api/quality/report`). The #155 row reads: *"Wraps user input + writes —
 * REST is correct"*. Owned by the `data-dictionary` plugin; constructed
 * and provided in `dataDictionaryPlugin.initialize` as an eager `useValue`
 * (same shape as `INTEGRITY_SERVICE_TOKEN`).
 *
 * Note: `getQualityReport` lives on this service even though it
 * semantically belongs to "quality." Future extraction into a dedicated
 * `QUALITY_SERVICE_TOKEN` is OUT OF SCOPE for this slice — see
 * `.claude/work/155-import-export/spec.md` "Out of scope."
 */
export const IMPORT_EXPORT_SERVICE_TOKEN = Symbol('ImportExportService');
