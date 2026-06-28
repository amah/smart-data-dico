import { Router } from 'express';
import { aiChat, aiChatApprove, aiStatus, aiGetConfig, aiSaveConfig, aiTools, aiMentionsSearch, aiTestTools, aiSqlRepair } from '../../controllers/aiController.js';

const router: Router = Router();
router.post('/api/ai/chat', aiChat);
// Server-side tool-approval gate: client posts approve/deny for a gated tool call.
router.post('/api/ai/chat/approve', aiChatApprove);
router.get('/api/ai/status', aiStatus);
router.get('/api/ai/config', aiGetConfig);
router.post('/api/ai/config', aiSaveConfig);
router.get('/api/ai/tools', aiTools);
// Mentions picker (#54)
router.get('/api/ai/mentions/search', aiMentionsSearch);
router.post('/api/ai/test-tools', aiTestTools);
// #run-sql — fix a failed query (schema + DB error → corrected SQL) for the auto-repair loop.
router.post('/api/ai/sql-repair', aiSqlRepair);
export default router;
