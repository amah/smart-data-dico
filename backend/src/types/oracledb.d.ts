/**
 * Minimal ambient declaration for the optional `oracledb` package.
 *
 * The oracledb package ships without TypeScript declarations on its main
 * module. We only use a tiny subset (Thin mode connection + execute) for
 * schema introspection in #69 C3, so a narrow declaration is enough.
 * Keeps `tsc --noEmit` clean without pulling in @types/oracledb.
 */
declare module 'oracledb' {
  export interface ConnectionAttributes {
    user: string;
    password: string;
    connectString: string;
  }

  export interface ExecuteOptions {
    outFormat?: number;
  }

  export interface Result<T = unknown> {
    rows?: T[];
    metaData?: unknown;
  }

  export interface Connection {
    execute<T = unknown>(
      sql: string,
      bindParams?: Record<string, unknown> | unknown[],
      options?: ExecuteOptions,
    ): Promise<Result<T>>;
    close(): Promise<void>;
  }

  export const OUT_FORMAT_OBJECT: number;
  export const OUT_FORMAT_ARRAY: number;
  export const versionString: string;
  export const thin: boolean;

  export function getConnection(attrs: ConnectionAttributes): Promise<Connection>;

  const _default: {
    getConnection: typeof getConnection;
    OUT_FORMAT_OBJECT: number;
    OUT_FORMAT_ARRAY: number;
    versionString: string;
    thin: boolean;
  };
  export default _default;
}
