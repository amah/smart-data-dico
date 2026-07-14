import { Router } from 'express';
import {
  createDocumentation,
  deleteDocumentation,
  getDocumentation,
  getDocumentationChunks,
  getDocumentationForElement,
  listDocumentation,
  updateDocumentation,
} from '../../controllers/documentationController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';
import { registerDocumentationAgentTools } from '../../services/documentation/agentTools.js';

registerDocumentationAgentTools();

const router: Router = Router();
router.get('/api/documentation', listDocumentation);
router.get('/api/documentation/for-element/:kind/:uuid', getDocumentationForElement);
router.get('/api/documentation/:uuid/chunks', getDocumentationChunks);
router.get('/api/documentation/:uuid', getDocumentation);
router.post('/api/documentation', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createDocumentation);
router.put('/api/documentation/:uuid', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateDocumentation);
router.delete('/api/documentation/:uuid', authorizeJwt([UserRole.ADMIN]), deleteDocumentation);

export default router;
