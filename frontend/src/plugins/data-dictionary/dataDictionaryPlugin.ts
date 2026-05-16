/**
 * Data Dictionary Plugin
 *
 * Declares ownership of /services/**, /dictionaries/** routes and
 * the services/entity/dictionary Redux slices. Components stay in
 * their current file locations — no file moves.
 */

import type { PluginModule } from '@hamak/microkernel-spi';
import { STORE_MANAGER_TOKEN, type IStoreManager } from '@hamak/ui-store-api';
import type { StoreFileSystemFacade } from '@hamak/ui-store-impl';
import {
  STORE_FS_TOKEN,
  STEREOTYPE_SERVICE_TOKEN,
  INTEGRITY_SERVICE_TOKEN,
  DIFF_SERVICE_TOKEN,
  IMPORT_EXPORT_SERVICE_TOKEN,
  METADATA_TYPE_REGISTRY_TOKEN,
  GIT_SERVICE_TOKEN,
  PUBLISH_SERVICE_TOKEN,
} from '../../kernel/tokens';
import { StereotypeService, type NotifyFn } from './services/StereotypeService';
import { IntegrityService } from './services/IntegrityService';
import { DiffService } from './services/DiffService';
import type { LogicalDiffOperand, PhysicalDiffSource } from './services/DiffService';
import { ImportExportService } from './services/ImportExportService';
import type { SchemaImportOptions, DbDialect } from './services/ImportExportService';
import { PublishService } from './services/PublishService';
import type { GitService } from '../git/services/GitService';
import type { Stereotype } from '../../types';
import type { RootState } from '../../kernel/bootstrap';
import { createMetadataTypeRegistry } from './metadata/MetadataTypeRegistry';
import { registerBuiltinContributions } from './metadata/builtinContributions';
import { UnknownTypeContribution } from './metadata/UnknownTypeEditor';

// Module-scope mutable notify slot. `initialize` constructs the service with a
// stable forwarder lambda that resolves `notifyImpl` at call time; `activate`
// later swaps in the real implementation backed by `ctx.commands.run` (which
// is only available on `ActivateContext`, not on `InitializationContext`).
//
// TODO(post-#156-merge): when PR #171 lands and the in-house notificationPlugin
// is replaced by the framework factory, the `ctx.commands.run` call needs its
// signature changed from positional `(level, message)` to `(level, { message })`.
// Single-line edit in the `activate` handler below.
let notifyImpl: NotifyFn = () => {};

export function createDataDictionaryPlugin(): PluginModule {
  return {
    async initialize(ctx) {
      // Declare route ownership
      ctx.views.register('routes.data-dictionary', () => ({
        routes: [
          '/packages/**',
          '/services/**',
          '/dictionaries/**',
          '/create',
        ],
      }));

      // #166 pilot: register StereotypeService.
      // dependsOn in bootstrap.ts MUST include 'store-fs' so STORE_FS_TOKEN
      // is providable by the time we run. Resolution returns the Proxy
      // (storeFsPlugin.ts); the underlying facade is filled during
      // store-fs.activate, which runs BEFORE data-dictionary.activate AND
      // BEFORE any component mounts — so by the time StereotypeService
      // methods are called, the Proxy is fully wired.
      const storeFs = ctx.resolve<StoreFileSystemFacade<RootState>>(
        STORE_FS_TOKEN,
      );
      const storeManager = ctx.resolve<IStoreManager>(STORE_MANAGER_TOKEN);

      // Wire notification command best-effort via a stable forwarder that
      // resolves `notifyImpl` at call time. The real implementation is
      // installed during `activate` (see below) where `ctx.commands.run` is
      // available. If the notification plugin is not present (e.g. in test
      // bootstrap), the forwarder remains a no-op.
      const notify: NotifyFn = (level, message) => notifyImpl(level, message);

      const service = new StereotypeService(
        storeFs,
        (action) => storeManager.dispatch(action),
        () => storeManager.getState<RootState>(),
        notify,
      );
      ctx.provide({
        provide: STEREOTYPE_SERVICE_TOKEN,
        useValue: service,
      });

      // Pattern B (#155): no kernel deps — register a self-contained axios wrapper.
      ctx.provide({
        provide: INTEGRITY_SERVICE_TOKEN,
        useValue: new IntegrityService(),
      });

      // #164 — registry-shaped Pattern B: construct, seed with 9 built-ins,
      // provide under METADATA_TYPE_REGISTRY_TOKEN. Other plugins may extend
      // it by calling ctx.resolve(METADATA_TYPE_REGISTRY_TOKEN).register(...).
      const metadataRegistry = createMetadataTypeRegistry({ unknownTypeFallback: UnknownTypeContribution });
      registerBuiltinContributions(metadataRegistry);
      ctx.provide({
        provide: METADATA_TYPE_REGISTRY_TOKEN,
        useValue: metadataRegistry,
      });

      // Pattern B (#155-diff): no kernel deps — register DiffService.
      ctx.provide({
        provide: DIFF_SERVICE_TOKEN,
        useValue: new DiffService(),
      });

      // Pattern B (#155): no kernel deps — register a self-contained axios wrapper.
      ctx.provide({
        provide: IMPORT_EXPORT_SERVICE_TOKEN,
        useValue: new ImportExportService(),
      });

      // ── #163 command registrations ────────────────────────────────────────
      // Resolve the four services this plugin already provided above.
      const stereotype = ctx.resolve<StereotypeService>(STEREOTYPE_SERVICE_TOKEN);
      const integrity  = ctx.resolve<IntegrityService>(INTEGRITY_SERVICE_TOKEN);
      const diff       = ctx.resolve<DiffService>(DIFF_SERVICE_TOKEN);
      const ie         = ctx.resolve<ImportExportService>(IMPORT_EXPORT_SERVICE_TOKEN);

      // Stereotype commands — each handler awaits the service method, emits an
      // event for cross-plugin observation, and returns the service result.
      ctx.commands.register('data-dictionary.stereotype.loadAll', () =>
        stereotype.loadAll(),
      );
      ctx.commands.register('data-dictionary.stereotype.create', async ({ data }: { data: Stereotype }) => {
        const created = await stereotype.create(data);
        ctx.hooks.emit('stereotype.changed', { id: created.id, op: 'create' });
        return created;
      });
      ctx.commands.register('data-dictionary.stereotype.update', async ({ id, data }: { id: string; data: Partial<Stereotype> }) => {
        const updated = await stereotype.update(id, data);
        ctx.hooks.emit('stereotype.changed', { id, op: 'update' });
        return updated;
      });
      ctx.commands.register('data-dictionary.stereotype.delete', async ({ id }: { id: string }) => {
        await stereotype.delete(id);
        ctx.hooks.emit('stereotype.changed', { id, op: 'delete' });
      });

      // Integrity — single read.
      ctx.commands.register('data-dictionary.integrity.getReport', () => integrity.getReport());

      // Diff — four reads.
      ctx.commands.register('data-dictionary.diff.getLogical', ({ left, right }: { left: LogicalDiffOperand; right: LogicalDiffOperand }) =>
        diff.getLogical(left, right),
      );
      ctx.commands.register('data-dictionary.diff.getPhysicalConfig', ({ service }: { service: string }) =>
        diff.getPhysicalConfig(service),
      );
      ctx.commands.register('data-dictionary.diff.getPhysicalForService', ({ service, source }: { service: string; source: PhysicalDiffSource }) =>
        diff.getPhysicalForService(service, source),
      );
      ctx.commands.register('data-dictionary.diff.getPhysicalAll', ({ sources, services }: { sources: Record<string, PhysicalDiffSource>; services?: string[] }) =>
        diff.getPhysicalAll(sources, services),
      );

      // Import / Export — eight calls. The commit handler emits an event.
      ctx.commands.register('data-dictionary.import-export.importJsonSchema', ({ schema, service }: { schema: unknown; service: string }) =>
        ie.importJsonSchema(schema, service),
      );
      ctx.commands.register('data-dictionary.import-export.importSqlDdl', ({ sql, service }: { sql: string; service: string }) =>
        ie.importSqlDdl(sql, service),
      );
      ctx.commands.register('data-dictionary.import-export.previewSqlDdl', ({ sql, options }: { sql: string; options?: SchemaImportOptions }) =>
        ie.previewSqlDdl(sql, options),
      );
      ctx.commands.register('data-dictionary.import-export.previewDbSchema', ({ dialect, connection, options }: { dialect: DbDialect; connection: Record<string, unknown>; options?: SchemaImportOptions }) =>
        ie.previewDbSchema(dialect, connection, options),
      );
      ctx.commands.register('data-dictionary.import-export.diffSqlDdl', ({ parsed, targetService }: { parsed: unknown[]; targetService: string }) =>
        ie.diffSqlDdl(parsed, targetService),
      );
      ctx.commands.register('data-dictionary.import-export.commitSqlDdl', async ({ parsed, targetService }: { parsed: unknown[]; targetService: string }) => {
        const res = await ie.commitSqlDdl(parsed, targetService);
        if (res?.data) {
          ctx.hooks.emit('import-export.committed', {
            service: targetService,
            added: res.data.added,
            merged: res.data.merged,
            unchanged: res.data.unchanged,
            removedInSource: res.data.removedInSource,
            written: res.data.written,
          });
        }
        return res;
      });
      ctx.commands.register('data-dictionary.import-export.exportJsonSchema', ({ service }: { service: string }) =>
        ie.exportJsonSchema(service),
      );
      ctx.commands.register('data-dictionary.import-export.exportMarkdown', ({ service }: { service: string }) =>
        ie.exportMarkdown(service),
      );

      // Quality — single read; emits an event so the HomePage widget can refresh
      // without cross-importing the service.
      ctx.commands.register('data-dictionary.quality.getReport', async ({ service }: { service?: string }) => {
        const report = await ie.getQualityReport(service);
        ctx.hooks.emit('quality.report.refreshed', { service, overall: report.overall });
        return report;
      });

      // ── #160 Git + Publish command registrations ──────────────────────────
      // Resolve GitService (provided by gitPlugin.initialize — guaranteed by
      // dependsOn: ['git'] in bootstrap.ts).
      // Guard: the git plugin is not bootstrapped in lightweight test harnesses
      // that only include [store, remote-fs, store-fs, data-dictionary].
      // We resolve best-effort; if GIT_SERVICE_TOKEN is absent we skip the
      // command registrations gracefully (StereotypeService tests are unaffected).
      let git: GitService | null = null;
      try {
        git = ctx.resolve<GitService>(GIT_SERVICE_TOKEN);
      } catch {
        // git plugin absent (test-only bootstrap) — skip git/publish commands.
      }

      if (git !== null) {
        const publish = new PublishService(git);
        ctx.provide({ provide: PUBLISH_SERVICE_TOKEN, useValue: publish });

        ctx.commands.register('data-dictionary.git.getStatus',    () => git!.getStatus());
        ctx.commands.register('data-dictionary.git.listBranches', () => git!.listBranches());
        ctx.commands.register('data-dictionary.git.checkout',     ({ branch, create }: { branch: string; create?: boolean }) => git!.checkout(branch, create));
        ctx.commands.register('data-dictionary.git.log',          ({ limit }: { limit?: number }) => git!.log(limit));
        ctx.commands.register('data-dictionary.git.diff',         ({ file }: { file?: string }) => git!.diff(file));
        ctx.commands.register('data-dictionary.git.pull',         ({ remote }: { remote?: string }) => git!.pull(remote));
        ctx.commands.register('data-dictionary.git.push',         ({ remote }: { remote?: string }) => git!.push(remote));

        ctx.commands.register('data-dictionary.publish.save',    ({ message }: { message: string }) => publish.save(message));
        ctx.commands.register('data-dictionary.publish.publish', ({ remote }: { remote?: string }) => publish.publish(remote));
        ctx.commands.register('data-dictionary.publish.sync',    ({ remote }: { remote?: string }) => publish.sync(remote));
        ctx.commands.register('data-dictionary.publish.revert',  ({ commitHash }: { commitHash: string }) => publish.revert(commitHash));
      }

      // Route ownership for the commands debug page.
      // (Route declared here because data-dictionary owns broad dev-tooling surfaces.)
      ctx.views.register('routes.commands-debug', () => ({
        routes: ['/commands'],
      }));
    },

    async activate(ctx) {
      // Install the real notify implementation. `.run` is the framework's
      // command-execute method (NOT `.execute`). The args object shape
      // `{ message }` matches @hamak/notification's factory which registers
      // handlers as `(args) => { const { message, ... } = args; ... }`
      // (notification-plugin-factory.js, post-PR #171).
      notifyImpl = (level, message) => {
        try {
          ctx.commands.run(`notification.${level}`, { message });
        } catch {
          // Notification plugin not present in test bootstrap; swallow.
        }
      };
      console.log('[data-dictionary] Plugin activated');
    },
  };
}
