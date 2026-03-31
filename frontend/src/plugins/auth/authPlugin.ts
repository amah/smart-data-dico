/**
 * Auth Plugin
 *
 * Registers auth service in DI, registers auth Redux slice,
 * and restores session on activate.
 */

import type { PluginModule } from '@hamak/microkernel-spi';
import { REDUCER_REGISTRY_TOKEN } from '@hamak/ui-store/api';
import { AuthService } from './AuthService';
import { AUTH_SERVICE_TOKEN } from '../../kernel/tokens';
import authReducer, { fetchCurrentUser } from '../../store/slices/authSlice';

export function createAuthPlugin(): PluginModule {
  const authService = new AuthService();

  return {
    async initialize(ctx) {
      // Register auth service in DI
      ctx.provide({ provide: AUTH_SERVICE_TOKEN, useValue: authService });
    },

    async activate(ctx) {
      // Restore session if token exists
      if (authService.isAuthenticated()) {
        try {
          // The store is ready at this point, dispatch via hooks
          ctx.hooks.emit('auth:session-restored');
        } catch (error) {
          console.warn('[auth] Failed to restore session:', error);
        }
      }
    },

    async deactivate() {
      // Cleanup if needed
    },
  };
}
