# Spec: Electron desktop — Tier 1 ($0 path)

Companion to `electron-packaging-study.md`. Goal: downloadable desktop installers
(macOS / Windows / Linux) on **GitHub Releases** at **$0 recurring cost** —
Linux clean, **Windows free-signed via SignPath**, **macOS unsigned + one-time
"Open Anyway"**. Reuses the existing bundled server + SPA; almost no app changes.

## Scope
**In:** native window hosting the existing server; per-OS installers; a tagged
GitHub Actions release pipeline; free Windows signing (SignPath).
**Out (deferred to Tier 2):** auto-update (electron-updater), macOS notarization,
bundled git. *Why out:* auto-update needs `latest*.yml` hashes to match the
**final** binary, but SignPath re-signs the Windows exe **after** electron-builder
computes those hashes — reconciling that is Tier 2 work. Tier 1 = manual download
+ install; "update" = download the newer release.

## File tree (new `desktop/` workspace)
```
desktop/
  package.json                 # electron + electron-builder devDeps; build/dist scripts
  tsconfig.json
  electron-builder.yml         # targets, asarUnpack, mac/win/linux, publish
  src/
    main.ts                    # main process (server supervisor + window)
    preload.ts                 # minimal IPC bridge (app version, open-folder)
    serverHost.ts              # free port, utilityProcess.fork, wait-for-ready, exit-75 respawn
    menu.ts                    # native menu (Open Folder, reload, devtools, Help→GitHub)
    dataDir.ts                 # resolve/scaffold project dir (ports cli.js bootstrap)
    nodeFlags.ts               # --experimental-sqlite probe (ported from bin/cli.js)
  build/
    server-launch.cjs          # CJS entry for utilityProcess → import('./server.mjs') (ESM can't be forked directly)
    afterPack.js               # macOS ad-hoc codesign (so arm64 will execute)
    entitlements.mac.plist     # used later for notarization; harmless now
    icon.icns / icon.ico / icon.png
.github/workflows/desktop-release.yml
```
The app reuses `backend/dist/server.mjs` + `frontend/dist/**` as **packaged
resources** — no new server code.

## Main process (`src/main.ts` + `serverHost.ts`)
Mirrors `bin/cli.js`, swapping "open browser" for a `BrowserWindow`.
```ts
// resources in the packaged app live under process.resourcesPath
const SERVER   = path.join(process.resourcesPath, 'backend', 'dist', 'server.mjs');
const FRONTEND = path.join(process.resourcesPath, 'frontend', 'dist');

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) return app.quit();
  const port = await freePort();                       // net.createServer(0)
  const dataDir = resolveDataDir();                    // app.getPath('userData')/projects/default (scaffold 1st run)
  startServer(port, dataDir);                          // utilityProcess.fork(SERVER, [], {...})
  await waitForServer(`http://127.0.0.1:${port}`);     // poll until 200, splash meanwhile
  win = new BrowserWindow({ width: 1400, height: 900, webPreferences: { preload } });
  await win.loadURL(`http://127.0.0.1:${port}`);
  Menu.setApplicationMenu(buildMenu());
});
app.on('before-quit', () => serverProc?.kill());
```
> **`.mjs` gotcha:** `utilityProcess.fork()` loads its entry via `require()` and **cannot fork an ESM `.mjs` directly** (`ERR_REQUIRE_ESM`). Fork a tiny **CJS launcher** instead — `desktop/build/server-launch.cjs` containing `import('./server.mjs')` — which then loads the ESM bundle. The bundle is kept as-is; just fronted by a 1-line shim.

```ts
// serverHost.ts — utilityProcess gives a Node child without needing a system `node`.
// Entry is a CJS launcher (build/server-launch.cjs → import('./server.mjs')).
serverProc = utilityProcess.fork(SERVER_LAUNCH_CJS, [], {
  execArgv: nodeFlags(),                               // ['--experimental-sqlite'] when gated
  env: { ...process.env, PORT: String(port), NODE_ENV: 'production',
         DATA_DIR: dataDir, SDD_FRONTEND_DIST: FRONTEND, SDD_MANAGED: '1' },
  stdio: 'inherit',
});
serverProc.on('exit', (code) => {                      // project-switch handshake (cli.js parity)
  if (code === 75) { const next = readActiveProject(); startServer(port, next); win.reload(); }
});
```
**"Open Folder"** (menu/IPC) → `dialog.showOpenDialog({properties:['openDirectory']})`
→ write `~/.dico-app/active-project` → kill child → respawn with new `DATA_DIR`
(reuses the server's existing switch path). Preload exposes only
`{ getVersion(), openFolder() }` over `contextBridge`; the SPA still talks to the
local server over HTTP exactly as in the browser.

## electron-builder (`electron-builder.yml`)
```yaml
appId: com.hamak.smart-data-dico
productName: Smart Data Dictionary
directories: { output: release, buildResources: build }
files: ["dist/**"]                          # compiled desktop main/preload only
asar: true
extraResources:                             # server runs as a Node file → must be outside asar
  - { from: "../backend/dist",  to: "backend/dist" }
  - { from: "../frontend/dist", to: "frontend/dist" }
afterPack: ./build/afterPack.js             # mac ad-hoc sign
publish: null                               # the workflow publishes, not electron-builder
mac:
  target: [{ target: dmg, arch: [arm64, x64] }, { target: zip, arch: [arm64, x64] }]
  category: public.app-category.developer-tools
  identity: null                            # UNSIGNED (ad-hoc applied in afterPack)
win:
  target: [nsis]                            # signed out-of-band by SignPath in CI
linux:
  target: [AppImage, deb]
  category: Development
```
```js
// build/afterPack.js — arm64 refuses to run a no-signature binary; ad-hoc fixes that ($0)
exports.default = async ({ appOutDir, electronPlatformName, packager }) => {
  if (electronPlatformName !== 'darwin') return;
  const app = `${appOutDir}/${packager.appInfo.productFilename}.app`;
  require('child_process').execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' });
};
```

## Windows signing — SignPath (free, OSS)
One-time onboarding (outside CI): apply to **SignPath Foundation** (OSI license,
actively maintained, malware-free), create a *project* + *signing policy* in their
portal, obtain `org-id`, `project-slug`, `policy-slug`, and a CI API token.
In CI: build the unsigned `nsis` exe → submit to SignPath → download the signed
exe → attach to the release. Until approval lands, ship the unsigned exe (users hit
SmartScreen → "More info → Run anyway"); flip on signing when the org is approved.

## GitHub Actions (`.github/workflows/desktop-release.yml`)
```yaml
name: Desktop Release
on:
  push: { tags: ['desktop-v*'] }            # separate namespace from npm `v*` tags
  workflow_dispatch:
jobs:
  build:
    strategy:
      matrix:
        include:
          - { os: macos-latest,   args: --mac }
          - { os: windows-latest, args: --win }
          - { os: ubuntu-latest,  args: --linux }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run build                                  # frontend + backend bundles
      - run: cd desktop && npm ci && npm run build          # tsc main/preload
      - run: cd desktop && npx electron-builder ${{ matrix.args }} --publish never
      - uses: actions/upload-artifact@v4
        with: { name: ${{ matrix.os }}, path: desktop/release/*.{dmg,zip,exe,AppImage,deb} }
  sign-windows:                                             # free OSS signing
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { name: windows-latest, path: win }
      - uses: signpath/github-action-submit-signing-request@v1
        with:
          api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
          organization-id: ${{ secrets.SIGNPATH_ORG_ID }}
          project-slug: smart-data-dico
          signing-policy-slug: release-signing
          artifact-configuration-slug: nsis-exe
          github-artifact-id: windows-latest
          wait-for-completion: true
          output-artifact-directory: win-signed
      - uses: actions/upload-artifact@v4
        with: { name: windows-signed, path: win-signed/* }
  release:
    needs: [build, sign-windows]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4               # mac, linux, windows-signed
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            macos-latest/*.dmg
            macos-latest/*.zip
            ubuntu-latest/*.AppImage
            ubuntu-latest/*.deb
            windows-signed/*.exe
          body: |
            ### Install
            - **macOS** (unsigned): open the dmg, drag to Applications, then right-click → Open, or System Settings → Privacy & Security → **Open Anyway** (one time).
            - **Windows**: run the installer (signed via SignPath; if SmartScreen appears, More info → Run anyway).
            - **Linux**: AppImage (chmod +x) or the .deb.
```
**Secrets:** `SIGNPATH_API_TOKEN`, `SIGNPATH_ORG_ID` (Windows only); `GITHUB_TOKEN` is automatic.

## Decisions / caveats
- **macOS friction is by design at $0** — unsigned + ad-hoc; users do a one-time "Open Anyway". Document in the release notes + a first-run hint. Notarization ($99/yr) is the Tier 2 upgrade.
- **`node:sqlite` in Electron** — validate it loads under `utilityProcess` with `--experimental-sqlite` on the target Electron's Node; if flaky, swap the SQLite executor to **`better-sqlite3`** (electron-rebuild). Gate this in Phase 1 acceptance.
- **Optional DB drivers** (oracledb/pg/mysql2/mssql) — **excluded** from the desktop bundle (already `external` in esbuild; just don't ship them). SQLite is the desktop default.
- **Git** — Tier 1 **requires system git** (the server already degrades gracefully without it). Bundling git via `dugite` (also $0, just effort) is the recommended fast-follow; flagged separately so it doesn't block Tier 1.
- **Resource paths** — `backend/dist` + `frontend/dist` via `extraResources` (outside asar) so the server can read them as files; main passes `SDD_FRONTEND_DIST`.
- **Monorepo** — `desktop/` as a workspace reusing the root `npm run build` artifacts; no separate repo.

## Acceptance criteria
- [ ] `desktop/` dev run (`electron .`) starts the bundled server on a free port and shows the app in a native window.
- [ ] "Open Folder" switches the active project (exit-75 respawn) without restarting Electron.
- [ ] `electron-builder` produces dmg+zip (mac arm64/x64), nsis (win), AppImage+deb (linux).
- [ ] macOS app launches after the documented "Open Anyway" (verified on Apple Silicon — ad-hoc sign works).
- [ ] SQLite run-SQL feature works inside the packaged app (or better-sqlite3 fallback adopted).
- [ ] Tagging `desktop-v*` runs the workflow and produces a GitHub Release with all five artifacts; the Windows exe is SignPath-signed (once onboarded).

## Verification (manual, end to end)
1. Local: `cd desktop && npm i && npm run build && npx electron-builder --dir` → launch the unpacked app → confirm window loads, a package renders, run a SQLite query.
2. Per-OS installer smoke test (or via CI artifacts): install, launch, "Open Folder", run a query.
3. Cut a `desktop-v0.1.0` tag on a branch → confirm the workflow builds, signs Windows, and drafts the release.
