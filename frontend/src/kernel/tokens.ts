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
