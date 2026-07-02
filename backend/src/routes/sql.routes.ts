/**
 * Routes for the run-SQL feature (#run-sql). Connecting (caches DB credentials)
 * needs ADMIN/EDITOR; running/fetching/closing are read-only and open to
 * viewers too.
 */
import { Router } from 'express';
import { sqlConnect, sqlGetConnection, sqlDisconnect, sqlRun, sqlFetch, sqlClose, sqlSecretCapabilities, sqlSecretStatus, sqlForgetSecret } from '../controllers/sqlController.js';
import { UserRole } from '../middleware/auth.js';
import { authorizeJwt } from '../middleware/jwtAuth.js';

const router: Router = Router();

const READ = authorizeJwt([UserRole.ADMIN, UserRole.EDITOR, UserRole.VIEWER]);
const WRITE = authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]);

router.post('/api/sql/connect', WRITE, sqlConnect);
router.get('/api/sql/connection/:packageName', READ, sqlGetConnection);
router.delete('/api/sql/connection/:packageName', WRITE, sqlDisconnect);
router.post('/api/sql/run', READ, sqlRun);
router.post('/api/sql/fetch', READ, sqlFetch);
router.post('/api/sql/close', READ, sqlClose);
// Optional password persistence in an OS-keyed secret store (#209).
router.get('/api/sql/secret-capabilities', READ, sqlSecretCapabilities);
router.post('/api/sql/secret-status', READ, sqlSecretStatus);
router.delete('/api/sql/secret/:packageName', WRITE, sqlForgetSecret);

export default router;
