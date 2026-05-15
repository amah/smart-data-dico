import { Router } from 'express';
import { listConversations, getConversation, saveConversation, patchConversation, deleteConversation } from '../../controllers/aiController.js';

const router: Router = Router();
router.get('/api/ai/conversations', listConversations);
router.get('/api/ai/conversations/:id', getConversation);
router.post('/api/ai/conversations', saveConversation);
router.patch('/api/ai/conversations/:id', patchConversation);
router.delete('/api/ai/conversations/:id', deleteConversation);
export default router;
