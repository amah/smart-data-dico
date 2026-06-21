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

/**
 * Maximum number of agentic tool-call steps the AI chat loop may take in a
 * single turn (#192). A single hardcoded constant — no env var / runtime
 * config — shared by BOTH provider paths (the AI SDK `stepCountIs` cap and the
 * direct-client `maxSteps` loop) so the two can never drift. When the loop
 * exhausts this budget it ends with a graceful model "summary turn" rather than
 * a silent cut-off.
 */
export const AI_MAX_STEPS = 500;

/**
 * Mutable data directory — updated by /api/project/open (#95).
 *
 * Production deployments point at their own project dir (via `DATA_DIR`
 * env or the CLI `--data-dir` flag). Dev defaults to the repo's bundled
 * sample project (`samples/eshop/`), which is the only sample the repo
 * ships (#post-107).
 */
let _dataDir = process.env.DATA_DIR
  || (isProduction
    ? path.join(process.cwd(), 'data-dictionaries')
    : path.join(process.cwd(), '..', 'samples', 'eshop'));

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
