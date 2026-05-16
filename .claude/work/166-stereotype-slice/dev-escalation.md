# Dev escalation — #166-stereotype-slice (cycle 1)

## What I tried

Implemented the spec verbatim and ran `cd frontend && npx tsc --noEmit`. Two type errors in our touched files (everything else either passes or is the documented pre-existing `AIChatPanel*.test.tsx` baseline noise).

## What failed

### Error 1: `ctx.commands.execute` does not exist

`src/plugins/data-dictionary/dataDictionaryPlugin.ts(54,29): error TS2339: Property 'execute' does not exist on type '{ register: (id: string, handler: (...a: any[]) => any) => void; }'.`

The spec's `dataDictionaryPlugin.initialize` body (spec lines 594-600) has:

```ts
const notify: NotifyFn = (level, message) => {
  try {
    void ctx.commands.execute(`notification.${level}`, { message });
  } catch {
    // Notification plugin not present; swallow.
  }
};
```

But the framework type `InitializationContext.commands` only has `.register` — verified at `frontend/node_modules/@hamak/microkernel-spi/dist/plugin.d.ts`:

```ts
commands: {
    register: (id: string, handler: (...a: any[]) => any) => void;
};
```

The full `CommandRegistry` (`@hamak/microkernel-api/dist/types.d.ts`) has `.register`, `.run`, `.has` — and `.run`, not `.execute`, is the call form. That registry IS exposed to `ActivateContext.commands` (verified at `host.js:31`), but NOT to `InitializationContext.commands`, which is the deliberately-narrower init-time shape.

Additionally: the spec cites `@hamak/notification/dist/impl/plugin/notification-plugin-factory.js:94` as defining `notification.error` with `(args: { message: string })` signature. But the in-tree notification plugin on `main` (`frontend/src/plugins/notification/notificationPlugin.ts:57`) is the in-house `SimpleNotificationService` wrapper and registers with the legacy `(message: string)` signature — NOT the framework factory the spec assumes. This is a second mismatch.

### Error 2: `FileSystemNodeAction` not assignable to `UnknownAction` (resolved without escalation)

`src/plugins/data-dictionary/services/StereotypeService.ts(186,7): error TS2345: Argument of type 'FileSystemNodeAction' is not assignable to parameter of type 'UnknownAction'.`

The spec's `StereotypeService` constructor takes `private readonly dispatch: Dispatch`. Redux's `Dispatch` defaults to `Dispatch<UnknownAction>`, and `UnknownAction` has an `[key: string]: unknown` index signature requirement that `FileSystemNodeAction` (which only carries `{ type, command }`) does not satisfy.

I have already applied a one-line, mechanically-equivalent fix: parameterize as `Dispatch<Action>` instead of the default. This preserves the spec's intent (the service dispatches typed framework actions, not arbitrary unknown actions) and required no behavior change. Reporting it here for transparency but NOT blocking on it.

## Why I think the spec needs revision

The spec's `notify` callback can't compile against `InitializationContext.commands` as the framework actually types it, AND the framework factory the spec cites isn't what `main`'s notification plugin actually exports.

Two viable resolutions exist; the spec needs to pick one:

**Option A — capture commands during `activate`, not `initialize`.**
Move the `notify` setup into `activate`'s ctx, which exposes the full `CommandRegistry`. Use `.run('notification.error', message)` (positional `message: string`, matching the in-house plugin signature on `main`). Service construction stays in `initialize` for DI ordering; pass a mutable `notify` slot that the activate hook fills in. Concretely:

```ts
let notify: NotifyFn = () => {};
async initialize(ctx) {
  // ... resolve storeFs, storeManager, build service with the closure ...
  const service = new StereotypeService(storeFs, …, (lvl, msg) => notify(lvl, msg));
  ctx.provide({ provide: STEREOTYPE_SERVICE_TOKEN, useValue: service });
}
async activate(ctx) {
  notify = (level, message) => {
    try {
      // .run is the framework method name, NOT .execute (registries.js:1).
      // Positional string message matches in-house notification plugin
      // (notificationPlugin.ts:56-59 on main), NOT the
      // `@hamak/notification` factory the spec mistakenly cites.
      ctx.commands.run(`notification.${level}`, message);
    } catch {
      // Notification plugin not present or command not registered; swallow.
    }
  };
}
```

This is the minimum-surgery option.

**Option B — bypass the command bus, resolve the notification service via DI.**
The in-house notification plugin provides a module-private `NOTIFICATION_TOKEN`. Exporting it (and possibly its `SimpleNotificationService` interface) and resolving it directly via `ctx.resolve(NOTIFICATION_TOKEN)` would let `notify` call `service.error(message)` synchronously without going through commands. But this changes the in-house plugin's surface and is a larger edit than the spec sized for.

**Recommendation**: Option A. Smallest delta, same architectural intent (commands as the bus), correct against framework types, robust to the absent-notification-plugin test bootstrap that the spec wants.

## Question for spec-writer

Are you happy with Option A as drafted above? Specifically:

1. Move the `notify` wiring from `initialize` into a second-stage `activate` step (storing a mutable closure-captured `notify` slot in module scope).
2. Use `ctx.commands.run(...)` (NOT `.execute`).
3. Pass the message as a positional string (NOT `{ message }`) because main's in-house `notificationPlugin.ts` uses the legacy `(message: string)` signature, NOT the framework factory the spec mistakenly cites.
4. Document the bug-A-style call-site discipline in a comment block on the activate handler (the user-visible behavior is unchanged; the citation in the spec re: `notification-plugin-factory.js:94` is stale and should be replaced with `frontend/src/plugins/notification/notificationPlugin.ts:56-59`).

If yes I'll continue. If you prefer Option B I'll wait for the revision.

## What I have applied so far

- Tokens, store-fs plugin, `useService.ts`, `StereotypesPage.tsx`, bootstrap registration, dependency edits — all per spec, all typecheck against their own surface.
- `StereotypeService.ts` — applied with `Dispatch<Action>` instead of bare `Dispatch` per Error 2 fix above.
- `dataDictionaryPlugin.ts` — drafted per spec text; the `notify` callback is the one TypeScript error preventing the new files from compiling clean.

Everything else is ready to go pending this answer.
