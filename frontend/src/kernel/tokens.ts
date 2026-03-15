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
