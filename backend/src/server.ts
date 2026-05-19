import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import routes from './routes/index.js';
import { logger } from './utils/logger.js';
import { config } from './kernel/config.js';
import { initializeFileSystem, getFileRouter } from './adapters/EntityFileAdapter.js';
import { createYamlFileInfoEnricher } from './adapters/YamlFileInfoEnricher.js';
import { registerStorageBackend } from './storage/contract/registerStorageBackend.js';
import { mcpClientRegistry } from './services/mcpClientRegistry.js';
export { registerStorageBackend };

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const port = config.port;

// Middleware
app.use(cors());
// Access logging middleware
app.use((req: Request, res: Response, next) => {
  const start = process.hrtime();
  res.on('finish', () => {
    const diff = process.hrtime(start);
    const executionTimeMs = Number((diff[0] * 1e3 + diff[1] / 1e6).toFixed(2));
    logger.info('HTTP Access', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      executionTimeMs
    });
  });
  next();
});

app.use(express.json());

// API welcome route (only in dev — production serves frontend at /)
if (!config.isProduction) {
  app.get('/', (req: Request, res: Response) => {
    res.json({ message: 'Welcome to the Data Dictionary Management System API' });
  });
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// API routes
app.use(routes);

// Setup Swagger documentation (dev only — swagger-ui-express requires static
// assets that aren't available in the production bundle).
// Wrapped in an IIFE so the top-level `await` doesn't break CJS transforms
// (e.g. Jest's ts-jest CommonJS mode used by the integration tests).
(async () => {
  try {
    const { setupSwagger } = await import('./utils/swagger.js');
    setupSwagger(app);
  } catch {
    logger.info('Swagger UI not available (production bundle)');
  }
})();

// =============================================================================
// Framework Filesystem & Git Routes (Phase 1)
// =============================================================================

async function mountFrameworkRoutes() {
  try {
    // Initialize filesystem framework
    const { workspaceManager, enricherRegistry } = await initializeFileSystem();

    // Register the git+filesystem storage backend singleton
    registerStorageBackend(workspaceManager);

    // Bootstrap the uuid → logical-path index (#167 slice 6c) for the
    // default dictionaries workspace. Per-workspace; #169 multi-workspace
    // work will extend this to fork-on-demand instances. Wrapped in try/catch
    // so a duplicate-uuid throw does NOT abort the framework-routes mount.
    try {
      const { wsId } = await import('./storage/contract/types.js');
      const { LogicalProjection } = await import('./storage/projection/LogicalProjection.js');
      const { registerProjection } = await import('./storage/projection/ProjectionRegistry.js');
      const { UuidIndex, registerUuidIndex } = await import('./storage/projection/UuidIndex.js');
      const { storageRegistry } = await import('./storage/contract/StorageBackendToken.js');
      const dictWs = wsId('dictionaries');
      const backend = storageRegistry.getBackend();
      const projection = new LogicalProjection(backend, dictWs);
      // Register the projection FIRST so the UuidIndex subscribes to the
      // SAME instance the /fs/logical route handlers will consume. This
      // closes slice-6c Risk §11.6 for projection-routed writes.
      registerProjection(dictWs, projection);
      const uuidIndex = new UuidIndex(projection, dictWs, backend);
      await uuidIndex.rebuild();
      uuidIndex.start();
      registerUuidIndex(dictWs, uuidIndex);
      logger.info('UuidIndex initialized (slice 6c) + LogicalProjection registered (slice 6d)');

      // Slice 6e.2 — start the raw-fs watcher. Opt-out via DICO_WATCH_RAW=0
      // (the test harness sets this; production leaves it unset → watcher on).
      if (process.env.DICO_WATCH_RAW !== '0') {
        try {
          const { RawFsWatcher } = await import('./storage/projection/RawFsWatcher.js');
          const watcher = new RawFsWatcher({
            dataDir: config.dataDir,
            ws: dictWs,
            projection,
            index: uuidIndex,
          });
          await watcher.start();
          logger.info('RawFsWatcher started (slice 6e.2)');
        } catch (watchError) {
          logger.warn(`RawFsWatcher initialization failed: ${watchError instanceof Error ? watchError.message : String(watchError)}`);
        }
      } else {
        logger.info('RawFsWatcher disabled (DICO_WATCH_RAW=0)');
      }
    } catch (e) {
      logger.warn(`Projection/UuidIndex initialization failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Register YAML entity enricher
    const yamlEnricher = createYamlFileInfoEnricher();
    enricherRegistry.register(yamlEnricher);

    // Initialize git service and routes
    try {
      const gitModule = await import('@hamak/ui-remote-git-fs-backend');
      const workspaceRoots = new Map<string, string>([
        ['dictionaries', config.dataDir],
      ]);
      // Expose for project switching (#95) — updating this map re-points
      // the git backend to the new data directory on next request.
      (app as any).__workspaceRoots = workspaceRoots;

      const gitService = gitModule.createGitService(workspaceRoots);
      const gitEnricher = gitModule.createGitFileInfoEnricher({
        gitService,
        workspaceRoots,
      });
      enricherRegistry.register(gitEnricher);

      const gitRoutes = gitModule.createGitRoutes({ gitService, debug: !config.isProduction });
      app.use('/api/git', gitRoutes as any);
      app.use('/api/git', gitModule.gitErrorHandler as any);

      logger.info('Git routes mounted at /api/git');
    } catch (gitError) {
      logger.warn(`Git integration not available: ${gitError}`);
    }

    // Mount filesystem routes
    const fsRouter = getFileRouter();
    app.use('/fs', fsRouter);
    // Slice 6d: /fs/raw is the semantic-explicit alias for the existing /fs
    // mount. Same Router instance — zero new state. The frontend may switch
    // `baseUrl: '/fs'` to `baseUrl: '/fs/raw'` in a follow-up ticket without
    // any backend change.
    app.use('/fs/raw', fsRouter);
    // Slice 6d: /fs/logical serves entity-level reads/writes/deletes against
    // the LogicalProjection registered above. Workspace path is the embedded
    // :workspace URL param (matches the framework's FileRouter URL shape).
    const { createLogicalFsRouter } = await import('./routes/logicalFsRouter.js');
    app.use('/fs/logical', createLogicalFsRouter());

    logger.info('Filesystem routes mounted at /fs, /fs/raw, /fs/logical');
  } catch (error) {
    logger.warn(`Framework filesystem not initialized: ${error}`);
  }
}

// Mount framework routes (non-blocking — existing routes work regardless)
mountFrameworkRoutes().catch((err) => {
  logger.warn(`Failed to mount framework routes: ${err}`);
});


// Serve frontend static files in production (BEFORE error handler)
if (config.isProduction) {
  // Check multiple possible frontend dist locations.
  // __dirname equivalent for ESM. The `import.meta` syntax is hidden from
  // CJS parsers (used by ts-jest in CommonJS mode for tests) via `new Function`,
  // since this branch only runs in production and is unreachable from tests.
  const getServerDir = new Function('return new URL(import.meta.url).pathname') as () => string;
  const serverDir = path.dirname(getServerDir());
  const candidates = [
    path.join(serverDir, '..', '..', 'frontend', 'dist'),  // npm package (server is at backend/src/)
    path.join(process.cwd(), 'public'),                     // Docker (copied to public/)
    path.join(process.cwd(), '..', 'frontend', 'dist'),     // monorepo dev
    path.join(process.cwd(), 'frontend', 'dist'),            // alt layout
  ];
  const publicDir = candidates.find(d => {
    try { return fs.statSync(d).isDirectory(); } catch { return false; }
  });

  if (publicDir) {
    app.use(express.static(publicDir));
    // SPA fallback — only for navigation requests, not assets/API
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/fs') || req.path.startsWith('/api-docs') || req.path.includes('.')) {
        return next();
      }
      res.sendFile(path.join(publicDir, 'index.html'));
    });
    logger.info(`Serving frontend from ${publicDir}`);
  } else {
    logger.warn('Frontend dist not found. API-only mode.');
  }
}

// Error handling middleware (after static files)
app.use((err: any, req: Request, res: Response, _next: any) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({
    message: 'Internal server error',
    error: config.isProduction ? undefined : err.message
  });
});

// Start server only when run directly (not when imported by tests)
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js') || process.argv[1].endsWith('server.mjs')
);

if (isMainModule) {
  const httpServer = app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
    logger.info(`API documentation available at http://localhost:${port}/api-docs`);
  });

  // Graceful shutdown — drain HTTP first, then drop MCP child
  // processes / HTTP transports via mcpClientRegistry.closeAll(). (#178)
  // Without this, stdio-transport MCP servers spawned by the agent
  // outlive the parent process on Ctrl-C.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal} — shutting down`);
    httpServer.close(() => { /* HTTP drained */ });
    try {
      await mcpClientRegistry.closeAll();
    } catch (err) {
      logger.warn(`mcpClientRegistry.closeAll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

export default app;