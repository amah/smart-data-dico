// CJS launcher for the backend server bundle.
//
// Why this file exists: `utilityProcess.fork()` loads its entry point via
// `require()`, which CANNOT load an ESM `.mjs` module directly — doing so throws
// `ERR_REQUIRE_ESM`. So the main process forks THIS CommonJS shim, which then
// uses a dynamic `import()` to pull in the ESM `backend/dist/server.mjs` bundle.
//
// The absolute path to the server bundle is passed in via the SDD_SERVER_ENTRY
// env var (falling back to argv[2]).
//
// Critically, the server bundle decides whether to call `app.listen()` by
// checking `process.argv[1]` (its `isMainModule` heuristic ends with
// "server.mjs"). When forked through this shim, argv[1] points at THIS file, so
// we rewrite argv[1] to the real server path *before* importing it — otherwise
// the server would load but never start listening.

const serverEntry = process.env.SDD_SERVER_ENTRY || process.argv[2];

if (!serverEntry) {
  console.error('[server-launch] No server entry path provided (set SDD_SERVER_ENTRY or pass as argv[2]).');
  process.exit(1);
}

// Make the bundle's `isMainModule` check pass: it reads process.argv[1] at
// module-eval time, which happens during the dynamic import below.
process.argv[1] = serverEntry;

import(serverEntry).catch((err) => {
  console.error('[server-launch] Failed to load server bundle:', err);
  process.exit(1);
});
