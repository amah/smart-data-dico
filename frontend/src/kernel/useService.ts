// frontend/src/kernel/useService.ts
//
// Resolve a DI token from the bootstrapped host's root activation context.
// This is the consumer-side mechanism specified by #155 Phase 2.
//
// Behavior:
//   - Throws if `host.rootActivationCtx` is not yet set (called before
//     bootstrap completed). That's a developer error; we don't paper over
//     it with `undefined`.
//   - Returns the resolved instance cast to T. The token IS the type
//     contract; no runtime validation.

import { host } from './bootstrap';

export function useService<T>(token: symbol | string): T {
  const ctx = host.rootActivationCtx;
  if (!ctx) {
    throw new Error(
      'useService called before host bootstrap completed. ' +
      'Ensure bootstrapApplication() has resolved before any component renders.',
    );
  }
  const svc = ctx.resolve<T>(token as symbol);
  if (svc === undefined || svc === null) {
    const name = typeof token === 'symbol' ? token.toString() : token;
    throw new Error(`useService: no provider registered for ${name}`);
  }
  return svc;
}
