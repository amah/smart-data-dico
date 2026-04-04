import { Router } from 'express';

import { getCurrentUser, login } from '../controllers/authController.js';
import { diagramController } from '../controllers/diagramController.js';
import { createDictionary, getDictionaries, getDictionaryById, getDictionaryEntries, getEntityAttributes, getPackageByPath, getPackageHierarchy, getRelatedEntities, getTabularData, saveEntity, listAllPackagesAndEntities, getFlatEntitiesAndAttributes, getEntityHierarchy, createRootPackage, createPackageAtPath, updatePackageAtPath, deletePackageAtPath } from '../controllers/dictionaryController.js';
import { createEntity, deleteEntity, getAllServices, getEntitySchema, getGraphData, getServiceEntities, searchEntities, updateEntity, getPackageRelationships, createRelationship, updateRelationship, deleteRelationship, getImpactAnalysis, getLineage, submitEntity, approveEntity, returnEntity, getEntityComments, addEntityComment, resolveEntityComment } from '../controllers/serviceController.js';
import { getAllStereotypes, getStereotype, createStereotype, updateStereotype, deleteStereotype } from '../controllers/stereotypeController.js';
import { getAllPerspectives, getPerspective, createPerspective, updatePerspective, deletePerspective, resolvePerspective, getPerspectiveGraph, upsertPerspectiveNode } from '../controllers/perspectiveController.js';
import { commitChanges, getCommitHistory, revertToCommit } from '../controllers/versionController.js';
import { importJsonSchema, importSqlDdl, exportJsonSchema, exportMarkdown, getQualityReport } from '../controllers/importExportController.js';
import { authenticate, UserRole } from '../middleware/auth.js';
import { authorizeJwt, verifyToken } from '../middleware/jwtAuth.js';

const router = Router();

// API status route
router.get('/api/status', (req, res) => {
  res.json({ status: 'operational' });
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

// Stereotype API
router.get('/api/stereotypes', getAllStereotypes);
router.get('/api/stereotypes/:id', getStereotype);
router.post('/api/stereotypes', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createStereotype);
router.put('/api/stereotypes/:id', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateStereotype);
router.delete('/api/stereotypes/:id', authorizeJwt([UserRole.ADMIN]), deleteStereotype);

// Perspective API
router.get('/api/perspectives', getAllPerspectives);
router.get('/api/perspectives/:id', getPerspective);
router.post('/api/perspectives', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createPerspective);
router.put('/api/perspectives/:id', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updatePerspective);
router.delete('/api/perspectives/:id', authorizeJwt([UserRole.ADMIN]), deletePerspective);
router.get('/api/perspectives/:id/resolve', resolvePerspective);
router.get('/api/perspectives/:id/graph', getPerspectiveGraph);
router.put('/api/perspectives/:id/nodes', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), upsertPerspectiveNode);

// Search API
router.get('/api/search', searchEntities);

// Impact analysis & lineage
router.get('/api/entities/:uuid/impact', getImpactAnalysis);
router.get('/api/entities/:uuid/lineage', getLineage);

// Import/Export
router.post('/api/import/json-schema', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), importJsonSchema);
router.post('/api/import/sql-ddl', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), importSqlDdl);
router.get('/api/export/json-schema/:service', exportJsonSchema);
router.get('/api/export/markdown/:service', exportMarkdown);

// Quality
router.get('/api/quality/report', getQualityReport);

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

// AI Chat API
try {
  const { aiChat, aiStatus, aiGetConfig, aiSaveConfig, listConversations, getConversation, saveConversation, deleteConversation } = await import('../controllers/aiController.js');
  router.post('/api/ai/chat', aiChat);
  router.get('/api/ai/status', aiStatus);
  router.get('/api/ai/config', aiGetConfig);
  router.post('/api/ai/config', aiSaveConfig);
  router.get('/api/ai/conversations', listConversations);
  router.get('/api/ai/conversations/:id', getConversation);
  router.post('/api/ai/conversations', saveConversation);
  router.delete('/api/ai/conversations/:id', deleteConversation);
} catch {
  // AI dependencies not available (optional feature)
}

export default router;
