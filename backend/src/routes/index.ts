import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { config } from '../kernel/config.js';

import { getCurrentUser, login } from '../controllers/authController.js';
import { diagramController } from '../controllers/diagramController.js';
import { createDictionary, getDictionaries, getDictionaryById, getDictionaryEntries, getEntityAttributes, getPackageByPath, getPackageHierarchy, getRelatedEntities, getTabularData, saveEntity, listAllPackagesAndEntities, getFlatEntitiesAndAttributes, getEntityHierarchy, createRootPackage, createPackageAtPath, updatePackageAtPath, deletePackageAtPath } from '../controllers/dictionaryController.js';
import { createEntity, deleteEntity, getAllServices, getEntitySchema, getGraphData, getServiceEntities, searchEntities, updateEntity, getPackageRelationships, createRelationship, updateRelationship, deleteRelationship, getImpactAnalysis, getLineage, submitEntity, approveEntity, returnEntity, getEntityComments, addEntityComment, resolveEntityComment } from '../controllers/serviceController.js';
import { getAllStereotypes, getStereotype, createStereotype, updateStereotype, deleteStereotype } from '../controllers/stereotypeController.js';
import { getModelMetadata, putModelMetadata } from '../controllers/modelMetadataController.js';
import { getAllCases, getCase, createCase, updateCase, deleteCase, resolveCase, getCaseGraph, upsertCaseNode } from '../controllers/caseController.js';
import { listRules, getRule, getRulesForEntity, createRule, updateRule, deleteRule } from '../controllers/ruleController.js';
import { getIntegrityReport } from '../controllers/integrityController.js';
import {
  logicalDiff,
  physicalDiff,
  impactDiffEndpoint,
  exportMigration,
  physicalDiffAll,
  impactDiffAll,
  exportMigrationAll,
  getPhysicalConfigController,
  putPhysicalConfigController,
  deletePhysicalConfigController,
} from '../controllers/diffController.js';
import { commitChanges, getCommitHistory, revertToCommit } from '../controllers/versionController.js';
import { importJsonSchema, importSqlDdl, previewSqlDdl, diffSqlDdl, commitSqlDdl, previewOracleSchema, previewDbSchema, exportJsonSchema, exportMarkdown, getQualityReport } from '../controllers/importExportController.js';
import { getDerivedTypes, putDerivedTypes } from '../controllers/dicoConfigController.js';
import { authenticate, UserRole } from '../middleware/auth.js';
import { authorizeJwt, verifyToken } from '../middleware/jwtAuth.js';

const router = Router();

// API status route — includes deployment mode info
router.get('/api/status', (req, res) => {
  const profile = process.env.PROFILE || 'local';
  res.json({
    status: 'operational',
    mode: profile === 'local' ? 'desktop' : 'server',
    profile,
    version: process.env.npm_package_version || '1.1.1',
    auth: profile === 'local' ? 'none' : 'jwt',
  });
});

router.get('/api/packages/hierarchy/:rootPackage', getPackageHierarchy);
router.get('/api/packages/tabular/:rootPackage', getTabularData);

// Package CRUD routes
router.post('/api/packages', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createRootPackage);
router.post('/api/packages/:rootPackage/subpackages/*', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createPackageAtPath);
router.put('/api/packages/:rootPackage/path/*', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updatePackageAtPath);
router.delete('/api/packages/:rootPackage/path/*', authorizeJwt([UserRole.ADMIN]), deletePackageAtPath);

router.get('/api/packages/:rootPackage/path/*', getPackageByPath);

// Auth routes
router.post('/api/auth/login', login);
router.get('/api/auth/me', verifyToken, getCurrentUser);

// Legacy Dictionary routes
router.get('/api/dictionaries', getDictionaries);
router.post('/api/dictionaries', createDictionary);
router.get('/api/dictionaries/:id', getDictionaryById);
router.get('/api/dictionaries/:id/entries', getDictionaryEntries);
router.get('/api/entities/:microservice/:entityName/attributes', getEntityAttributes);
router.get('/api/entities/:microservice/:entityName/related', getRelatedEntities);
router.post('/api/entities', saveEntity);

// Data Dictionary/Entity/Package API extensions
router.get('/api/packages/all', listAllPackagesAndEntities);
router.get('/api/entities/flat', getFlatEntitiesAndAttributes);
router.get('/api/entities/hierarchy/:microservice/:entityName', getEntityHierarchy);

// New Service/Entity API routes
router.get('/api/services', getAllServices);
router.get('/api/services/:service/entities', getServiceEntities);
router.get('/api/services/:service/entities/:entity', getEntitySchema);
router.post('/api/services/:service/entities', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createEntity);
router.put('/api/services/:service/entities/:entity', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateEntity);
router.delete('/api/services/:service/entities/:entity', authorizeJwt([UserRole.ADMIN]), deleteEntity);

// Entity review workflow
router.post('/api/services/:service/entities/:entity/submit', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), submitEntity);
router.post('/api/services/:service/entities/:entity/approve', authorizeJwt([UserRole.ADMIN]), approveEntity);
router.post('/api/services/:service/entities/:entity/return', authorizeJwt([UserRole.ADMIN]), returnEntity);
router.get('/api/services/:service/entities/:entity/comments', getEntityComments);
router.post('/api/services/:service/entities/:entity/comments', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), addEntityComment);
router.put('/api/services/:service/entities/:entity/comments/:id', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), resolveEntityComment);

// Package-level relationship CRUD routes
router.get('/api/packages/:packageName/relationships', getPackageRelationships);
router.post('/api/packages/:packageName/relationships', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createRelationship);
router.put('/api/packages/:packageName/relationships/:uuid', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateRelationship);
router.delete('/api/packages/:packageName/relationships/:uuid', authorizeJwt([UserRole.ADMIN]), deleteRelationship);

// Model-level metadata (#94)
router.get('/api/model/metadata', getModelMetadata);
router.put('/api/model/metadata', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), putModelMetadata);

// Stereotype API
router.get('/api/stereotypes', getAllStereotypes);
router.get('/api/stereotypes/:id', getStereotype);
router.post('/api/stereotypes', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createStereotype);
router.put('/api/stereotypes/:id', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateStereotype);
router.delete('/api/stereotypes/:id', authorizeJwt([UserRole.ADMIN]), deleteStereotype);

// Case API (#121 — renamed from Perspective)
router.get('/api/cases', getAllCases);
router.get('/api/cases/:id', getCase);
router.post('/api/cases', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createCase);
router.put('/api/cases/:id', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateCase);
router.delete('/api/cases/:id', authorizeJwt([UserRole.ADMIN]), deleteCase);
router.get('/api/cases/:id/resolve', resolveCase);
router.get('/api/cases/:id/graph', getCaseGraph);
router.put('/api/cases/:id/nodes', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), upsertCaseNode);

// Legacy alias — 308-redirects /api/perspectives/* to /api/cases/* for one release.
router.all('/api/perspectives*', (req, res) => {
  const target = '/api/cases' + req.path.replace('/api/perspectives', '');
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(308, target + query);
});

// Rule API (#74)
router.get('/api/rules', listRules);
router.get('/api/rules/:uuid', getRule);
router.post('/api/rules', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createRule);
router.put('/api/rules/:uuid', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateRule);
router.delete('/api/rules/:uuid', authorizeJwt([UserRole.ADMIN]), deleteRule);
router.get('/api/entities/:entityUuid/rules', getRulesForEntity);

// Integrity API (#85 R5) — unified validation + constraints + rules report
router.get('/api/integrity', getIntegrityReport);

// Diff API (#86, #88) — model comparison
router.post('/api/diff/logical', logicalDiff);
router.post('/api/diff/physical', physicalDiff);
router.post('/api/diff/impact', impactDiffEndpoint);
router.post('/api/export/migration', exportMigration);
// Whole-model (all-services) diff endpoints
router.post('/api/diff/physical/all', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), physicalDiffAll);
router.post('/api/diff/impact/all', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), impactDiffAll);
router.post('/api/export/migration/all', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), exportMigrationAll);
// Per-service physical config (non-secret persisted dialect + connection)
router.get('/api/services/:service/physical-config', getPhysicalConfigController);
router.put('/api/services/:service/physical-config', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), putPhysicalConfigController);
router.delete('/api/services/:service/physical-config', authorizeJwt([UserRole.ADMIN]), deletePhysicalConfigController);

// Search API
router.get('/api/search', searchEntities);

// Impact analysis & lineage
router.get('/api/entities/:uuid/impact', getImpactAnalysis);
router.get('/api/entities/:uuid/lineage', getLineage);

// Import/Export
router.post('/api/import/json-schema', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), importJsonSchema);
router.post('/api/import/sql-ddl', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), importSqlDdl);
// Preview SQL DDL → parsed entities (no disk writes) — #69 C1
router.post('/api/import/sql-ddl/preview', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), previewSqlDdl);
// Diff parsed entities against an existing service — #69 C2
router.post('/api/import/sql-ddl/diff', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), diffSqlDdl);
// Merge + commit parsed entities into a service — #69 C2
router.post('/api/import/sql-ddl/commit', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), commitSqlDdl);
// Live Oracle DB introspection (Thin mode) → parsed entities (no disk writes) — #69 C3
router.post('/api/import/oracle/preview', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), previewOracleSchema);
// Unified live DB introspection — dispatches on body.dialect (oracle|postgres|mysql|mssql) — #79/#80/#81
router.post('/api/import/db/preview', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), previewDbSchema);
router.get('/api/export/json-schema/:service', exportJsonSchema);
router.get('/api/export/markdown/:service', exportMarkdown);

// Quality
router.get('/api/quality/report', getQualityReport);

// ═══════════════════════════════════════════════════════════════════════
// Project management (#95) — open/close/init local folders
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /api/filesystem/browse?path=/some/dir
 *
 * Lists subdirectories at the given path so the frontend can render a
 * folder picker without needing the File System Access API (which can't
 * return actual paths). Local-mode only.
 */
router.get('/api/filesystem/browse', (req, res) => {
  if (config.profile !== 'local') {
    return res.status(403).json({ message: 'Filesystem browsing is only available in local mode' });
  }
  const dirPath = (req.query.path as string) || os.homedir();
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return res.status(400).json({ message: `Not a directory: ${resolved}` });
  }
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const directories = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const hasDataDictionaries = fs.existsSync(path.join(resolved, 'dico.config.json'))
      || fs.existsSync(path.join(resolved, 'data-dictionaries', 'dico.config.json'));
    res.json({
      data: {
        path: resolved,
        parent: path.dirname(resolved),
        directories,
        hasDataDictionaries,
      },
    });
  } catch (e) {
    res.status(500).json({ message: `Failed to read directory: ${e}` });
  }
});

router.get('/api/project', (req, res) => {
  const dataDir = config.dataDir;
  const isOpen = fs.existsSync(path.join(dataDir, 'dico.config.json'));
  res.json({
    data: {
      path: dataDir,
      name: path.basename(path.dirname(dataDir)) || path.basename(dataDir),
      isOpen,
      profile: config.profile,
    },
  });
});

router.get('/api/project/status', async (_req, res) => {
  try {
    const { versionService } = await import('../services/versionService.js');
    const status = await versionService.getWorkingTreeStatus();
    res.json({ data: status });
  } catch (e) {
    res.status(500).json({ message: `Failed to read project status: ${e}` });
  }
});

router.post('/api/project/open', authorizeJwt([UserRole.ADMIN]), (req, res) => {
  if (config.profile !== 'local') {
    return res.status(403).json({ message: 'Project switching is only available in local mode' });
  }
  const { path: dirPath } = req.body;
  if (!dirPath || typeof dirPath !== 'string') {
    return res.status(400).json({ message: 'path (string) is required' });
  }
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) {
    return res.status(400).json({ message: `Path does not exist: ${resolved}` });
  }
  // Accept either the project folder itself or its parent containing data-dictionaries/
  const dataDir = fs.existsSync(path.join(resolved, 'dico.config.json'))
    ? resolved
    : fs.existsSync(path.join(resolved, 'data-dictionaries', 'dico.config.json'))
      ? path.join(resolved, 'data-dictionaries')
      : null;
  if (!dataDir) {
    return res.status(400).json({
      message: `No dico.config.json found at ${resolved}. Use /api/project/init to create one.`,
    });
  }
  config.dataDir = dataDir;
  // Update workspace roots for the git backend if available
  const roots = (req.app as any).__workspaceRoots as Map<string, string> | undefined;
  if (roots) roots.set('dictionaries', dataDir);
  res.json({ message: `Project opened: ${dataDir}`, data: { path: dataDir, name: path.basename(path.dirname(dataDir)) } });
});

router.post('/api/project/close', authorizeJwt([UserRole.ADMIN]), (req, res) => {
  if (config.profile !== 'local') {
    return res.status(403).json({ message: 'Project switching is only available in local mode' });
  }
  // Reset to the default (empty-ish) — callers should treat isOpen=false as "no project"
  const emptyDir = path.join(os.tmpdir(), 'smart-data-dico-closed');
  if (!fs.existsSync(emptyDir)) fs.mkdirSync(emptyDir, { recursive: true });
  config.dataDir = emptyDir;
  const roots = (req.app as any).__workspaceRoots as Map<string, string> | undefined;
  if (roots) roots.set('dictionaries', emptyDir);
  res.json({ message: 'Project closed' });
});

router.post('/api/project/init', authorizeJwt([UserRole.ADMIN]), (req, res) => {
  if (config.profile !== 'local') {
    return res.status(403).json({ message: 'Project initialization is only available in local mode' });
  }
  const { path: dirPath } = req.body;
  if (!dirPath || typeof dirPath !== 'string') {
    return res.status(400).json({ message: 'path (string) is required' });
  }
  const resolved = path.resolve(dirPath);
  const dataDir = resolved.endsWith('data-dictionaries')
    ? resolved
    : path.join(resolved, 'data-dictionaries');
  try {
    // Project marker + .dico/ system folder (#104). Packages live at the
    // project root and are created on demand (#105).
    fs.mkdirSync(path.join(dataDir, '.dico'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, '.dico', 'diagrams'), { recursive: true });
    const configPath = path.join(dataDir, 'dico.config.json');
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify({ version: 1 }, null, 2) + '\n', 'utf-8');
    }
    const stereotypesPath = path.join(dataDir, '.dico', 'stereotypes.yaml');
    if (!fs.existsSync(stereotypesPath)) {
      fs.writeFileSync(stereotypesPath, '[]', 'utf-8');
    }
    // Auto-open the new project
    config.dataDir = dataDir;
    const roots = (req.app as any).__workspaceRoots as Map<string, string> | undefined;
    if (roots) roots.set('dictionaries', dataDir);
    res.json({ message: `Project initialized and opened: ${dataDir}`, data: { path: dataDir } });
  } catch (e) {
    res.status(500).json({ message: `Failed to initialize project: ${e}` });
  }
});

// Derived data types (#107) — stored under `dico.config.json.types[]`
router.get('/api/config/types', getDerivedTypes);
router.put('/api/config/types', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), putDerivedTypes);

// Graph API for visualization
router.get('/api/graph/:service', getGraphData);

// Version control API
router.post('/api/commit', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), commitChanges);
router.get('/api/history', getCommitHistory);
router.post('/api/revert', authorizeJwt([UserRole.ADMIN]), revertToCommit);

// Diagram layout API
router.get('/api/diagrams', diagramController.listDiagramLayouts.bind(diagramController));
router.post('/api/diagrams', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), diagramController.saveDiagramLayout.bind(diagramController));
router.get('/api/diagrams/:id', diagramController.loadDiagramLayout.bind(diagramController));
router.put('/api/diagrams/:id', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), diagramController.updateDiagramLayout.bind(diagramController));
router.delete('/api/diagrams/:id', authorizeJwt([UserRole.ADMIN]), diagramController.deleteDiagramLayout.bind(diagramController));

// AI Chat API.
// Wrapped in an async IIFE so the top-level `await import` doesn't break CJS
// transforms (e.g. ts-jest in CommonJS mode used by integration tests).
// Routes are registered asynchronously after the controller module loads;
// the express router accepts late additions, so requests that arrive before
// the import finishes simply 404 until then.
(async () => {
  try {
    const { aiChat, aiStatus, aiGetConfig, aiSaveConfig, aiTools, listConversations, getConversation, saveConversation, deleteConversation } = await import('../controllers/aiController.js');
    router.post('/api/ai/chat', aiChat);
    router.get('/api/ai/status', aiStatus);
    router.get('/api/ai/config', aiGetConfig);
    router.post('/api/ai/config', aiSaveConfig);
    router.get('/api/ai/tools', aiTools);
    const { aiTestTools } = await import('../controllers/aiController.js');
    router.post('/api/ai/test-tools', aiTestTools);
    router.get('/api/ai/conversations', listConversations);
    router.get('/api/ai/conversations/:id', getConversation);
    router.post('/api/ai/conversations', saveConversation);
    router.delete('/api/ai/conversations/:id', deleteConversation);
  } catch {
    // AI dependencies not available (optional feature)
  }
})();

export default router;
