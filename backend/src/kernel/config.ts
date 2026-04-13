/**
 * Centralized Configuration
 *
 * Single source of truth for backend configuration values.
 * Reads from environment variables with sensible defaults.
 */

import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

/** Mutable data directory — updated by /api/project/open (#95). */
let _dataDir = process.env.DATA_DIR
  || (isProduction
    ? path.join(process.cwd(), 'data-dictionaries')
    : path.join(process.cwd(), '..', 'data-dictionaries'));

export const config = {
  /** Server port */
  port: parseInt(process.env.PORT || '3001', 10),

  /** Base directory for data dictionaries (YAML files). Mutable at runtime (#95). */
  get dataDir(): string { return _dataDir; },
  set dataDir(v: string) { _dataDir = v; },

  /** Deployment profile: local | team | server */
  profile: (process.env.PROFILE || 'local') as 'local' | 'team' | 'server',

  /** JWT configuration */
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  /** Git configuration */
  git: {
    /** Whether to auto-commit on entity changes */
    autoCommit: process.env.GIT_AUTO_COMMIT !== 'false',
  },

  /** Environment */
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
};
