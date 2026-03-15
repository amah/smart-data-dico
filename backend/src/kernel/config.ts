/**
 * Centralized Configuration
 *
 * Single source of truth for backend configuration values.
 * Reads from environment variables with sensible defaults.
 */

import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  /** Server port */
  port: parseInt(process.env.PORT || '3001', 10),

  /** Base directory for data dictionaries (YAML files) */
  dataDir: path.join(process.cwd(), '..', 'data-dictionaries'),

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
  isProduction: process.env.NODE_ENV === 'production',
};
