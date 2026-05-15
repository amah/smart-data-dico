import { Router } from 'express';
import { commitChanges, getCommitHistory, revertToCommit } from '../../controllers/versionController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
// Version control API
router.post('/api/commit', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), commitChanges);
router.get('/api/history', getCommitHistory);
router.post('/api/revert', authorizeJwt([UserRole.ADMIN]), revertToCommit);
export default router;
