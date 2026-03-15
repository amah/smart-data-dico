/**
 * useAuth Hook
 *
 * Convenience hook that resolves auth state from the Redux store.
 * Replaces per-component auth checks with a single, store-based approach.
 */

import { useSelector, useDispatch } from 'react-redux';
import { useCallback } from 'react';
import type { RootState, AppDispatch } from '../../kernel/bootstrap';
import { login, logout, fetchCurrentUser } from '../../store/slices/authSlice';

export function useAuth() {
  const dispatch = useDispatch<AppDispatch>();
  const auth = useSelector((state: RootState) => state.auth);

  const doLogin = useCallback(
    (username: string, password: string) => dispatch(login({ username, password })),
    [dispatch]
  );

  const doLogout = useCallback(() => dispatch(logout()), [dispatch]);

  const doFetchUser = useCallback(
    () => dispatch(fetchCurrentUser()),
    [dispatch]
  );

  return {
    user: auth?.user ?? null,
    token: auth?.token ?? null,
    isAuthenticated: auth?.isAuthenticated ?? false,
    loading: auth?.loading ?? false,
    error: auth?.error ?? null,
    login: doLogin,
    logout: doLogout,
    fetchCurrentUser: doFetchUser,
  };
}
