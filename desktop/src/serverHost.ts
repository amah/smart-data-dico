/**
 * Server supervisor: forks the bundled backend in an Electron `utilityProcess`
 * (which provides a Node runtime without a system `node`), waits for it to
 * answer, and handles project switching.
 *
 * Two switch paths, both converging on a respawn with a new DATA_DIR:
 *  - in-SPA: the backend (managed mode) persists the target to active-project
 *    and exits with code 75; we read the file and respawn (cli.js parity).
 *  - native menu: `switchTo()` kills the child and respawns directly.
 *
 * The port is fixed for the app's lifetime, so the BrowserWindow URL stays valid
 * across switches — the caller just reloads the window via `onSwitched`.
 */
import { utilityProcess, type UtilityProcess } from 'electron';
import * as http from 'node:http';
import * as net from 'node:net';
import { nodeFlags } from './nodeFlags';
import { readActiveProject } from './dataDir';

/** Exit code the backend uses to ask its supervisor to respawn (project switch). */
const RESTART_EXIT_CODE = 75;

export interface ServerHostOptions {
  /** CJS launcher forked by utilityProcess (it import()s the ESM server bundle). */
  serverLaunchCjs: string;
  /** Absolute path to backend/dist/server.mjs (passed to the launcher). */
  serverMjs: string;
  /** Absolute path to frontend/dist (passed as SDD_FRONTEND_DIST). */
  frontendDist: string;
  /** Called after an automatic (exit-75) respawn becomes ready — reload the UI. */
  onSwitched?: () => void;
}

export class ServerHost {
  private proc: UtilityProcess | null = null;
  private port = 0;
  private dir = '';
  private stopping = false;

  constructor(private readonly opts: ServerHostOptions) {}

  /** http URL the BrowserWindow should load. */
  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Pick a free TCP port via an ephemeral listen. */
  static freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(() => resolve(port));
      });
    });
  }

  /** First boot: bind the port, fork the server, resolve once it answers. */
  async start(port: number, dataDir: string): Promise<void> {
    this.port = port;
    this.spawn(dataDir);
    await this.waitForReady();
  }

  /** Native-menu project switch: kill the child and respawn with a new dir. */
  async switchTo(dataDir: string): Promise<void> {
    await this.stop();
    this.spawn(dataDir);
    await this.waitForReady();
  }

  /** Kill the child for good (app quitting). */
  dispose(): void {
    this.stopping = true;
    this.proc?.kill();
    this.proc = null;
  }

  private spawn(dataDir: string): void {
    this.dir = dataDir;
    this.stopping = false;
    const flags = nodeFlags();
    console.log(`[serverHost] Electron Node ${process.versions.node}; execArgv: ${flags.join(' ') || '(none)'}; DATA_DIR=${dataDir}`);
    this.proc = utilityProcess.fork(this.opts.serverLaunchCjs, [], {
      execArgv: flags,
      env: {
        ...process.env,
        SDD_SERVER_ENTRY: this.opts.serverMjs,
        PORT: String(this.port),
        NODE_ENV: 'production', // turns on the server's express.static SPA serving
        PROFILE: 'local', // enables /api/project/* switching (cli.js parity)
        DATA_DIR: dataDir,
        SDD_FRONTEND_DIST: this.opts.frontendDist,
        SDD_MANAGED: '1', // lets the backend use the exit-75 restart path
      },
      stdio: 'inherit',
    });

    this.proc.on('exit', (code) => {
      this.proc = null;
      if (this.stopping) return; // intentional kill (switchTo / dispose)
      if (code === RESTART_EXIT_CODE) {
        // In-SPA project switch: the backend persisted the target; respawn it.
        const next = readActiveProject() ?? this.dir;
        console.log(`[serverHost] project switch (exit 75) → ${next}`);
        this.spawn(next);
        void this.waitForReady().then(() => this.opts.onSwitched?.());
      } else {
        console.error(`[serverHost] server child exited unexpectedly (code ${code})`);
      }
    });
  }

  /** Stop the current child and wait for it to exit (so the port frees). */
  private stop(): Promise<void> {
    return new Promise((resolve) => {
      const p = this.proc;
      if (!p) return resolve();
      this.stopping = true;
      p.once('exit', () => resolve());
      p.kill();
    });
  }

  /** Poll the server's /health until it answers (or time out). */
  private waitForReady(timeoutMs = 30_000): Promise<void> {
    const url = `${this.url}/health`;
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const tick = () => {
        const req = http.get(url, (res) => {
          res.resume();
          if (res.statusCode === 200) return resolve();
          retry();
        });
        req.on('error', retry);
        req.setTimeout(1500, () => req.destroy());
      };
      const retry = () => {
        if (Date.now() > deadline) return reject(new Error('Server did not become ready in time'));
        setTimeout(tick, 300);
      };
      tick();
    });
  }
}
