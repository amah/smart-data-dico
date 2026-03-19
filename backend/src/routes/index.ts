import { Router } from 'express';

import { getCurrentUser, login } from '../controllers/authController.js';
import { diagramController } from '../controllers/diagramController.js';
import { createDictionary, getDictionaries, getDictionaryById, getDictionaryEntries, getEntityAttributes, getPackageByPath, getPackageHierarchy, getRelatedEntities, getTabularData, saveEntity, listAllPackagesAndEntities, getFlatEntitiesAndAttributes, getEntityHierarchy } from '../controllers/dictionaryController.js';
import { createEntity, deleteEntity, getAllServices, getEntitySchema, getGraphData, getServiceEntities, searchEntities, updateEntity, getPackageRelationships, createRelationship, updateRelationship, deleteRelationship } from '../controllers/serviceController.js';
import { commitChanges, getCommitHistory, revertToCommit } from '../controllers/versionController.js';
import { authenticate, UserRole } from '../middleware/auth.js';
import { authorizeJwt, verifyToken } from '../middleware/jwtAuth.js';

const router = Router();

// API status route
router.get('/api/status', (req, res) => {
  res.json({ status: 'operational' });
});

router.get('/api/packages/hierarchy/:rootPackage', getPackageHierarchy);
router.get('/api/packages/tabular/:rootPackage', getTabularData);
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

// Package-level relationship CRUD routes
router.get('/api/packages/:packageName/relationships', getPackageRelationships);
router.post('/api/packages/:packageName/relationships', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createRelationship);
router.put('/api/packages/:packageName/relationships/:uuid', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateRelationship);
router.delete('/api/packages/:packageName/relationships/:uuid', authorizeJwt([UserRole.ADMIN]), deleteRelationship);

// Search API
router.get('/api/search', searchEntities);

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

export default router;
