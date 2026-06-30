/**
 * Reverse-engineer plugin (front side).
 *
 * Declares ownership of /reverse-engineer and registers a command that mines a
 * repo's Liquibase changelog + git history into data-dictionary CIR via the
 * backend service (POST /api/reverse-engineer/run). The page is wired in App.tsx
 * (route → ReverseEngineerPage); the command is the framework-idiomatic entry so
 * other plugins / the command palette can trigger an extraction too.
 */
import type { PluginModule } from '@hamak/microkernel-spi';
import { reverseEngineerApi, type ReverseEngineerInput } from '../../services/api';
import { registerSettingsSection } from '../settingsContributions';
import ReverseEngineerSettings from './ReverseEngineerSettings';

// Contribute the Jira/Confluence config to the Settings page (no edits to Settings.tsx).
registerSettingsSection(ReverseEngineerSettings);

export function createReverseEngineerPlugin(): PluginModule {
  return {
    async initialize(ctx) {
      ctx.views.register('routes.reverse-engineer', () => ({ routes: ['/reverse-engineer'] }));

      ctx.commands.register('reverse-engineer.run', (input: ReverseEngineerInput) =>
        reverseEngineerApi.run(input),
      );
    },

    async activate() {
      console.log('[reverse-engineer] Plugin activated');
    },
  };
}
