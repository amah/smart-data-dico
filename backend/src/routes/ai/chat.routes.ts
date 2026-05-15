import { Router } from 'express';
import { aiChat, aiStatus, aiGetConfig, aiSaveConfig, aiTools, aiMentionsSearch, aiTestTools } from '../../controllers/aiController.js';

const router: Router = Router();
router.post('/api/ai/chat', aiChat);
router.get('/api/ai/status', aiStatus);
router.get('/api/ai/config', aiGetConfig);
router.post('/api/ai/config', aiSaveConfig);
router.get('/api/ai/tools', aiTools);
// Mentions picker (#54)
router.get('/api/ai/mentions/search', aiMentionsSearch);
router.post('/api/ai/test-tools', aiTestTools);
export default router;
