/**
 * Ambient stubs for the optional DB driver packages used by the
 * Postgres / MySQL / MSSQL introspectors (#79/#80/#81).
 *
 * Each introspector lazy-imports its driver and accesses it via `any`, so we
 * only need a bare module declaration to keep `tsc --noEmit` clean when the
 * driver isn't installed locally. Real types come from the package itself
 * when it is present; these declarations are overridden by the package's
 * shipped `.d.ts` files in that case.
 */

declare module 'pg';
declare module 'mysql2/promise';
declare module 'mssql';
