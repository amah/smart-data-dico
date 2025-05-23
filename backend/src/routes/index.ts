import { Router } from 'express';
import { login, getCurrentUser } from '../controllers/authController';
import {
  getDictionaries,
  getDictionaryById,
  getDictionaryEntries,
  getEntityAttributes,
  saveEntity,
  getRelatedEntities,
  createDictionary
} from '../controllers/dictionaryController';

import {
  getAllServices,
  getServiceEntities,
  getEntitySchema,
  createEntity,
  updateEntity,
  deleteEntity,
  searchEntities,
  getGraphData
} from '../controllers/serviceController';

import {
  commitChanges,
  getCommitHistory,
  revertToCommit
} from '../controllers/versionController';

import { diagramController } from '../controllers/diagramController';

import { authenticate, UserRole } from '../middleware/auth';
import { verifyToken, authorizeJwt } from '../middleware/jwtAuth';

const router = Router();

// API status route
router.get('/api/status', (req, res) => {
  res.json({ status: 'operational' });
});

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

// New Service/Entity API routes
router.get('/api/services', getAllServices);
router.get('/api/services/:service/entities', getServiceEntities);
router.get('/api/services/:service/entities/:entity', getEntitySchema);
router.post('/api/services/:service/entities', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createEntity);
router.put('/api/services/:service/entities/:entity', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateEntity);
router.delete('/api/services/:service/entities/:entity', authorizeJwt([UserRole.ADMIN]), deleteEntity);

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