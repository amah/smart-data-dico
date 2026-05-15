// frontend/src/kernel/useCommand.ts
//
// React-side wrapper. Components call `const run = useCommand()` once and
// then `await run('<name>', input)` per action. Mirrors the simplicity of
// `useService.ts` — no React state, just a stable function.
//
// The returned function reads `host.rootActivationCtx` at call time (not at
// hook-call time). This matches how `useService.ts` works and avoids stale
// closure issues on HMR re-bootstrap: the ctx is resolved fresh each time
// `run(...)` is invoked.

import { useCallback } from 'react';
import { host } from './bootstrap';
import type { CommandName, CommandInput, CommandOutput } from './commands';

export function useCommand(): <K extends CommandName>(
  name: K,
  ...args: CommandInput<K> extends void ? [] : [CommandInput<K>]
) => Promise<CommandOutput<K>> {
  return useCallback(
    <K extends CommandName>(
      name: K,
      ...args: CommandInput<K> extends void ? [] : [CommandInput<K>]
    ): Promise<CommandOutput<K>> => {
      const ctx = host.rootActivationCtx;
      if (!ctx) {
        throw new Error(
          'useCommand: host not bootstrapped. ' +
          'Ensure bootstrapApplication() has resolved before any component renders.',
        );
      }
      return ctx.commands.run(name, ...(args as any[]));
    },
    [], // stable — never changes after bootstrap
  );
}
