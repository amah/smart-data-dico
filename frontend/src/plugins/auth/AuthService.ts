/**
 * AuthService
 *
 * Wraps existing authApi to provide a DI-injectable auth service.
 */

import { authApi } from '../../services/api';
import type { User } from '../../types';

export class AuthService {
  async login(username: string, password: string): Promise<{ token: string; user: User }> {
    return await authApi.login(username, password);
  }

  logout(): void {
    authApi.logout();
  }

  async getCurrentUser(): Promise<User> {
    return await authApi.getCurrentUser();
  }

  isAuthenticated(): boolean {
    return authApi.isAuthenticated();
  }
}
