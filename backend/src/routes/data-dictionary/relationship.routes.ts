import { Router } from 'express';
import {
  getPackageRelationships,
  createRelationship,
  updateRelationship,
  deleteRelationship,
} from '../../controllers/serviceController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
// Package-level relationship CRUD routes
router.get('/api/packages/:packageName/relationships', getPackageRelationships);
router.post('/api/packages/:packageName/relationships', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createRelationship);
router.put('/api/packages/:packageName/relationships/:uuid', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateRelationship);
router.delete('/api/packages/:packageName/relationships/:uuid', authorizeJwt([UserRole.ADMIN]), deleteRelationship);
export default router;
