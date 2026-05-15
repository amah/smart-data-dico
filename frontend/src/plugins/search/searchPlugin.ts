/**
 * Search Plugin
 *
 * Declares ownership of /search, /entities/flat routes
 * and the search Redux slice.
 */

import type { PluginModule } from '@hamak/microkernel-spi';
import { SEARCH_SERVICE_TOKEN } from '../../kernel/tokens';
import { SearchService } from './services/SearchService';

export function createSearchPlugin(): PluginModule {
  return {
    async initialize(ctx) {
      ctx.views.register('routes.search', () => ({
        routes: [
          '/search',
          '/entities/flat',
          '/flat/**',
          '/tree/**',
        ],
      }));

      // #155-search: Pattern B service registration.
      // Eager useValue — no kernel deps; SearchService is self-contained.
      ctx.provide({
        provide: SEARCH_SERVICE_TOKEN,
        useValue: new SearchService(),
      });
    },

    async activate(_ctx) {
      console.log('[search] Plugin activated');
    },
  };
}
