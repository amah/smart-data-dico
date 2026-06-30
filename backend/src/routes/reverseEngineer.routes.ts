/**
 * Routes for the reverse-engineer plugin. Extraction reads local repos + writes
 * a CIR store, so it requires ADMIN/EDITOR and is local-mode only (enforced in
 * the controller). Jira/Confluence config (holds a token) is ADMIN-only.
 */
import { Router } from 'express';
import {
  reverseEngineerRun,
  reverseEngineerRunStream,
  detectMavenChangelogs,
  jiraGetConfig,
  jiraSaveConfig,
  jiraTestConnection,
  confluenceGetConfig,
  confluenceSaveConfig,
  confluenceTestConnection,
} from '../controllers/reverseEngineerController.js';
import { UserRole } from '../middleware/auth.js';
import { authorizeJwt } from '../middleware/jwtAuth.js';

const router: Router = Router();

const WRITE = authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]);
const ADMIN = authorizeJwt([UserRole.ADMIN]);

router.post('/api/reverse-engineer/run', WRITE, reverseEngineerRun);
router.post('/api/reverse-engineer/run-stream', WRITE, reverseEngineerRunStream);
router.post('/api/reverse-engineer/detect', WRITE, detectMavenChangelogs);
router.get('/api/reverse-engineer/jira-config', ADMIN, jiraGetConfig);
router.post('/api/reverse-engineer/jira-config', ADMIN, jiraSaveConfig);
router.post('/api/reverse-engineer/jira-test', ADMIN, jiraTestConnection);
router.get('/api/reverse-engineer/confluence-config', ADMIN, confluenceGetConfig);
router.post('/api/reverse-engineer/confluence-config', ADMIN, confluenceSaveConfig);
router.post('/api/reverse-engineer/confluence-test', ADMIN, confluenceTestConnection);

export default router;
