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
    const { enricherRegistry } = await initializeFileSystem();

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

    logger.info('Filesystem routes mounted at /fs');
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
  app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
    logger.info(`API documentation available at http://localhost:${port}/api-docs`);
  });
}

export default app;