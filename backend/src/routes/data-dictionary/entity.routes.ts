import { Router } from 'express';
import {
  getEntityAttributes,
  getRelatedEntities,
  saveEntity,
  getEntityHierarchy,
} from '../../controllers/dictionaryController.js';
import {
  createEntity,
  deleteEntity,
  getAllServices,
  getEntitySchema,
  getServiceEntities,
  updateEntity,
  submitEntity,
  approveEntity,
  returnEntity,
  getEntityComments,
  addEntityComment,
  resolveEntityComment,
} from '../../controllers/serviceController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
// Legacy /api/entities/:microservice/:entityName/{attributes,related}
router.get('/api/entities/:microservice/:entityName/attributes', getEntityAttributes);
router.get('/api/entities/:microservice/:entityName/related', getRelatedEntities);
// saveEntity and getEntityHierarchy
router.post('/api/entities', saveEntity);
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
export default router;
