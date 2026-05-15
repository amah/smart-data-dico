import { Router } from 'express';
import { getModelMetadata, putModelMetadata } from '../../controllers/modelMetadataController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
// Model-level metadata (#94)
router.get('/api/model/metadata', getModelMetadata);
router.put('/api/model/metadata', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), putModelMetadata);
export default router;
