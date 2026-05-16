// frontend/src/kernel/commands.ts
//
// Typed command surface. The DI'd services contribute the command set.
// Adding a new command means:
//   1. Add the {input, output} pair to `CommandMap` below.
//   2. Register it in the owning plugin's `initialize` via `ctx.commands.register`.
//   3. Call it from components via `useCommand()(name, input)`.
// Removing a command means: delete the key here, delete the register call,
// delete the call-sites. Type errors enforce the audit.
//
// Total: 19 (pre-#160 baseline) + 11 (#160: git + publish) = 30 keys.

import { host } from './bootstrap';
import type { Stereotype } from '../types';
import type {
  LogicalDiffOperand,
  PhysicalDiffSource,
  LogicalDiffResult,
  PhysicalDiffResult,
  PhysicalDiffAllResult,
  PhysicalConfig,
} from '../plugins/data-dictionary/services/DiffService';
import type {
  IntegrityReport,
} from '../plugins/data-dictionary/services/IntegrityService';
import type {
  SchemaImportOptions,
  DbDialect,
  ImportResponse,
  PreviewResponse,
  DiffResponse,
  CommitResponse,
  QualityReport,
} from '../plugins/data-dictionary/services/ImportExportService';
import type {
  SearchFilters,
  SearchResponse,
} from '../plugins/search/services/SearchService';
import type {
  GitStatusDTO,
  GitBranchListDTO,
  GitLogEntryDTO,
} from '../plugins/git/services/GitService';
import type { SaveResult } from '../plugins/data-dictionary/services/PublishService';

export interface CommandMap {
  // ── Stereotypes (data-dictionary) ────────────────────────────────────
  'data-dictionary.stereotype.loadAll': {
    input: void;
    output: Stereotype[];
  };
  'data-dictionary.stereotype.create': {
    // Wrapped to match the dominant CommandMap shape (17 of 19 inputs are
    // `{ key: value, ... }` objects). The handler destructures `{ data }`.
    input: { data: Stereotype };
    output: Stereotype;
  };
  'data-dictionary.stereotype.update': {
    input: { id: string; data: Partial<Stereotype> };
    output: Stereotype;
  };
  'data-dictionary.stereotype.delete': {
    input: { id: string };
    output: void;
  };

  // ── Integrity (data-dictionary) ──────────────────────────────────────
  'data-dictionary.integrity.getReport': {
    input: void;
    output: IntegrityReport;
  };

  // ── Diff (data-dictionary) ───────────────────────────────────────────
  'data-dictionary.diff.getLogical': {
    input: { left: LogicalDiffOperand; right: LogicalDiffOperand };
    output: LogicalDiffResult;
  };
  'data-dictionary.diff.getPhysicalConfig': {
    input: { service: string };
    output: PhysicalConfig;
  };
  'data-dictionary.diff.getPhysicalForService': {
    input: { service: string; source: PhysicalDiffSource };
    output: PhysicalDiffResult;
  };
  'data-dictionary.diff.getPhysicalAll': {
    input: { sources: Record<string, PhysicalDiffSource>; services?: string[] };
    output: PhysicalDiffAllResult;
  };

  // ── Import / Export (data-dictionary) ────────────────────────────────
  'data-dictionary.import-export.importJsonSchema': {
    input: { schema: unknown; service: string };
    output: ImportResponse;
  };
  'data-dictionary.import-export.importSqlDdl': {
    input: { sql: string; service: string };
    output: ImportResponse;
  };
  'data-dictionary.import-export.previewSqlDdl': {
    input: { sql: string; options?: SchemaImportOptions };
    output: PreviewResponse;
  };
  'data-dictionary.import-export.previewDbSchema': {
    input: { dialect: DbDialect; connection: Record<string, unknown>; options?: SchemaImportOptions };
    output: PreviewResponse;
  };
  'data-dictionary.import-export.diffSqlDdl': {
    input: { parsed: unknown[]; targetService: string };
    output: DiffResponse;
  };
  'data-dictionary.import-export.commitSqlDdl': {
    input: { parsed: unknown[]; targetService: string };
    output: CommitResponse;
  };
  'data-dictionary.import-export.exportJsonSchema': {
    input: { service: string };
    output: unknown;
  };
  'data-dictionary.import-export.exportMarkdown': {
    input: { service: string };
    output: string;
  };

  // ── Quality (data-dictionary) ────────────────────────────────────────
  'data-dictionary.quality.getReport': {
    input: { service?: string };
    output: QualityReport;
  };

  // ── Search (search) ──────────────────────────────────────────────────
  'search.search': {
    input: { query: string; filters?: SearchFilters };
    output: SearchResponse;
  };

  // ── Git transport (data-dictionary owns the user-facing commands,
  //    delegates to GitService) ──────────────────────────────────────────
  'data-dictionary.git.getStatus': { input: void; output: GitStatusDTO; };
  'data-dictionary.git.listBranches': { input: void; output: GitBranchListDTO; };
  'data-dictionary.git.checkout': { input: { branch: string; create?: boolean }; output: void; };
  'data-dictionary.git.log': { input: { limit?: number }; output: GitLogEntryDTO[]; };
  'data-dictionary.git.diff': { input: { file?: string }; output: { diff: string; file?: string }; };
  'data-dictionary.git.pull': { input: { remote?: string }; output: void; };
  'data-dictionary.git.push': { input: { remote?: string }; output: void; };

  // ── Save & Publish (PublishService composites) ──────────────────────────
  'data-dictionary.publish.save': { input: { message: string }; output: SaveResult; };
  'data-dictionary.publish.publish': { input: { remote?: string }; output: void; };
  'data-dictionary.publish.sync': { input: { remote?: string }; output: void; };
  'data-dictionary.publish.revert': { input: { commitHash: string }; output: { newCommitHash?: string }; };
}

export type CommandName = keyof CommandMap;
export type CommandInput<K extends CommandName> = CommandMap[K]['input'];
export type CommandOutput<K extends CommandName> = CommandMap[K]['output'];

/**
 * Run a typed command via the host's root activation context. Throws if
 * called pre-bootstrap (same contract as `useService`).
 *
 * Implementation calls `host.rootActivationCtx.commands.run(name, input)`,
 * which matches `CommandRegistry.run(id: string, ...args: any[])` from
 * `@hamak/microkernel-api/dist/types.d.ts` — verified.
 *
 * Note: Prefer `useCommand()` in React components (which reads the host at
 * call time). `runCommand` is provided for non-React contexts (thunks, etc.).
 * It imports `host` from `./bootstrap` at call time via a wrapper that avoids
 * any module-parse-time ordering issue.
 */
export function runCommand<K extends CommandName>(
  name: K,
  ...args: CommandInput<K> extends void ? [] : [CommandInput<K>]
): Promise<CommandOutput<K>> {
  const ctx = host.rootActivationCtx;
  if (!ctx) {
    throw new Error(
      'runCommand called before host bootstrap completed. ' +
      'Ensure bootstrapApplication() has resolved before any component renders.',
    );
  }
  return ctx.commands.run(name, ...(args as any[]));
}
