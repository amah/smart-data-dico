# Study: Electron desktop packaging (GitHub-distributed, VSCode-style)

Status: **exploratory** — evaluation + recommended approach, not yet a commitment.

## 1. Goal
Ship Smart Data Dictionary as a downloadable desktop app (macOS / Windows / Linux) from **GitHub Releases**, the way VSCode/GitHub Desktop are distributed: native window, installer per-OS, auto-update, and (the hard part) code-signed so the OS doesn't block it.

## 2. Why this app is a good Electron fit
The current architecture already does the hard part. From the launch map:
- `bin/cli.js` spawns the **self-contained** `backend/dist/server.mjs` (esbuild ESM bundle; only optional DB drivers + `fsevents` are external) and opens the system browser at `http://localhost:<port>`.
- The backend **serves the built SPA** (`express.static` of `SDD_FRONTEND_DIST` + SPA fallback) and all `/api`, `/fs`, `/api/git` routes.
- App data is split: **project data** = `DATA_DIR` (a git repo folder); **app storage** = `~/.dico-app/` (config, conversations, prompts).

So Electron's job is essentially: **start the existing server, point a `BrowserWindow` at `http://localhost:<port>` instead of the system browser.** Almost no app code changes.

## 3. Recommended architecture
```
Electron main process
 ├─ pick a free port
 ├─ start the bundled server  (backend/dist/server.mjs)   ← reuse cli.js logic
 │     via utilityProcess.fork(serverPath, [], {
 │        execArgv: nodeFlags(),            // --experimental-sqlite when needed
 │        env: { PORT, DATA_DIR, SDD_FRONTEND_DIST, SDD_MANAGED:'1', ... }
 │     })
 ├─ wait until the port answers, then
 ├─ BrowserWindow.loadURL(`http://localhost:${port}`)
 ├─ native menu, single-instance lock, "Open project folder" dialog → DATA_DIR
 └─ supervise child: exit-code-75 (project switch) → respawn with new DATA_DIR
```
**Why `utilityProcess.fork`** (Electron's Node child) rather than `child_process` + a system `node`: a packaged Electron app has **no standalone `node` binary**. `utilityProcess.fork` runs the bundle in Electron's own Node runtime (supports `execArgv` for flags). *Fallback:* run the Express app in-process in main via `import()` — simplest, but couples lifecycles; keep as plan B.

The renderer stays a thin shell loading localhost — no need to rewrite the SPA for `file://`. The exit-75 project-switch handshake ports over directly (main watches child exit code).

## 4. Tooling
- **electron-builder** — multi-OS installers (dmg / nsis / AppImage+deb), GitHub Releases publishing (`--publish always`), and **electron-updater** auto-update built in. (Alternative: electron-forge — fine, but electron-builder is the common choice for GitHub-distributed apps.)
- New workspace `desktop/` (or `electron/`): `main.ts`, `preload.ts`, `electron-builder.yml`. Consumes existing `backend/dist/` + `frontend/dist/` as packaged resources (via `extraResources` / `asarUnpack` — the server bundle is run as a Node file, so it must live **outside the asar** or be unpacked; same for the served frontend dist).

## 5. App-specific challenges (the parts beyond a vanilla Electron app)

**A. Git binary (the big one).** Versioning uses `simple-git` (via `@hamak/ui-remote-git-fs-backend`), which **shells out to the system `git`**. A desktop user may not have git. Options:
- **Bundle a portable git** with `dugite-native` / `dugite` (what GitHub Desktop & VSCode-adjacent tools use) and point the git path at it. Caveat: `dugite` ships **symlinks** that **ASAR doesn't handle** → must `asarUnpack` it (known electron-builder issue). Most robust.
- Require system git (simpler, but bad UX on clean Windows/macOS). Not VSCode-grade.
- Recommendation: **bundle git**, set the git path env before mounting `/api/git`.

**B. `node:sqlite` in Electron.** The SQL feature's default dialect uses Node's built-in `node:sqlite` (needs `--experimental-sqlite` on gated Node versions). Electron ships its own Node build; the flag can be passed via `utilityProcess` `execArgv`, but **availability must be validated per Electron version**. Safer alternative for desktop: bundle **`better-sqlite3`** (native, via `electron-rebuild`) behind the same executor interface. Decision point — validate `node:sqlite` first; fall back to `better-sqlite3` if flaky.

**C. Optional native DB drivers** (`oracledb`, `mysql2`, `pg`, `mssql`). They're native/heavy and would each need `electron-rebuild` for Electron's ABI. Recommendation: **don't bundle them in the desktop app by default** — ship SQLite (zero-dep) as the desktop default; document that Postgres/Oracle introspection is a server/CLI-deployment feature, or add them later as an opt-in. (`fsevents` is macOS-only and electron-builder handles it.)

**D. Resource paths.** The server reads files by path (`SDD_FRONTEND_DIST`, the bundle itself). In a packaged app these live under `process.resourcesPath`; main computes and passes them. `backend/dist/*` and `frontend/dist/*` go in `asarUnpack`/`extraResources`.

**E. Data location.** Keep `~/.dico-app/` for app storage (works as-is), or relocate to `app.getPath('userData')` for cleaner per-app isolation. Project data: a **"Open Folder"** dialog (VSCode-style) sets `DATA_DIR`; first-run can scaffold a default project (cli.js already has this logic).

## 6. Distribution & signing (the VSCode-grade hurdle)
This is where "available on GitHub like VSCode" gets expensive/fiddly — unsigned apps are blocked by Gatekeeper (macOS) and warned by SmartScreen (Windows).
- **macOS:** Apple **Developer ID Application** cert + **notarization** (`notarytool`), hardened runtime + entitlements. Requires Apple Developer Program ($99/yr). electron-builder + `CSC_LINK`/`CSC_KEY_PASSWORD` + `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`.
- **Windows:** **Authenticode** cert. OV cert still trips SmartScreen until reputation builds; **EV cert** avoids it (pricier, hardware/cloud-HSM). electron-builder via `CSC_LINK`.
- **Linux:** AppImage/deb/rpm — no signing required (optional).
- **Auto-update:** electron-updater with the **GitHub provider** (Releases as the feed). Note: on macOS, **updates only work if the app is signed**.
- **CI:** GitHub Actions matrix (`macos-latest`, `windows-latest`, `ubuntu-latest`); on a `v*` tag → build + sign + `electron-builder --publish always`. Secrets hold the certs.

## 7. Phasing (each independently demoable)
- **Phase 0 — PoC (hours):** `desktop/main.ts` that forks `backend/dist/server.mjs` on a free port and loads it in a BrowserWindow. Proves the model end-to-end locally.
- **Phase 1 — Package (unsigned):** electron-builder configs; produce dmg/nsis/AppImage; one manual GitHub Release. Validate `node:sqlite` inside Electron here.
- **Phase 2 — Git + data UX:** bundle git (dugite, asarUnpack), "Open Folder" dialog, app-data path, native menu, single-instance.
- **Phase 3 — Signing + auto-update + CI:** macOS notarization, Windows Authenticode, electron-updater (GitHub), GitHub Actions release pipeline on tags.

## 8. Open decisions / costs
1. **Signing budget:** Apple Developer ($99/yr) + Windows cert (OV ~$100–400/yr, EV more). Without these, GitHub downloads work but show scary OS warnings.
2. **Git:** bundle (recommended) vs require system git.
3. **SQLite in Electron:** validate `node:sqlite` vs adopt `better-sqlite3`.
4. **Native DB drivers in desktop:** exclude by default (recommended) vs `electron-rebuild` them in.
5. **Repo layout:** `desktop/` workspace in this monorepo (recommended — reuses dist artifacts) vs separate repo.
6. **App data:** keep `~/.dico-app/` vs `app.getPath('userData')`.

## 9. Avoiding the signing costs

The cert costs come from the **OS trust model, not Electron** — Tauri/NW.js/etc. face the identical Apple + Windows requirements, so switching frameworks saves nothing here. Real levers, by platform:

**The genuinely-free option (already shipping): the npm CLI.** `npx @hamak/smart-data-dico` / `npm i -g` needs **zero** code signing and works today. For this app's technical audience (data architects/engineers), that's a legitimate primary distribution; the Electron app is optional polish, not a prerequisite.

**Windows — effectively free, no expensive EV cert needed:**
- **SignPath Foundation** — free OV code-signing for qualifying OSS (OSI license, actively maintained, malware-free). Signed server-side via CI; cert issued to SignPath Foundation. → **$0**.
- **Azure Trusted Signing** — Microsoft-managed, short-lived certs, **~$10/month**, and Microsoft-trusted so it helps SmartScreen. (Public trust limited to orgs in US/CA/EU/UK and individuals in US/CA as of 2026.)
- Either beats buying a traditional OV/EV cert. Or ship unsigned + "More info → Run anyway," or distribute via Scoop/Winget.

**macOS — the one place a small fee is hard to avoid:**
- A **no-warning** experience requires **notarization → Apple Developer Program, $99/yr**. There is no free path to notarization.
- Free alternative: ship **unsigned** and have users do a one-time **System Settings → Privacy & Security → "Open Anyway"**. **Ad-hoc sign** (free, `codesign --sign -`) so the app at least *executes* on Apple Silicon (arm64 requires *some* signature), but Gatekeeper still flags it as unnotarized once.
- Note: **Homebrew is no longer a workaround** — `--no-quarantine` is deprecated and casks failing Gatekeeper are dropped Sept 1, 2026.

**Linux — always free** (AppImage/deb/rpm/Flatpak/Snap; no signing required).

**Bottom line:** the realistic minimum to ship a polished desktop app is **$99/yr (macOS notarization only)** — Windows free via SignPath, Linux free. Or **$0** if you accept a one-time macOS "Open Anyway", sign Windows via SignPath/Azure, and keep the **npm CLI** as the frictionless path. Recommended tiering: **Tier 0** npm CLI (now, $0) → **Tier 1** unsigned Electron on GitHub Releases ($0: Linux clean, Windows free-signed via SignPath, macOS "Open Anyway") → **Tier 2** add macOS notarization ($99/yr) only when that friction actually bites.

## 10. References
- electron-builder + auto-update + signing: https://www.electron.build , https://www.electron.build/auto-update
- Electron code signing/notarization: https://www.electronjs.org/docs/latest/tutorial/code-signing
- macOS sign+notarize via GitHub Actions: https://til.simonwillison.net/electron/sign-notarize-electron-macos , https://github.com/omkarcloud/macos-code-signing-example
- Bundling git: https://github.com/desktop/dugite , https://github.com/desktop/dugite-native (ASAR symlink caveat: dugite issue #140)
- electron-updater example: https://github.com/iffy/electron-updater-example
