import { Router } from 'express';
import { listPrompts, getPrompt, createPrompt, updatePrompt, deletePrompt } from '../../controllers/aiController.js';

const router: Router = Router();
// Saved prompts (#123)
router.get('/api/ai/prompts', listPrompts);
router.get('/api/ai/prompts/:id', getPrompt);
router.post('/api/ai/prompts', createPrompt);
router.put('/api/ai/prompts/:id', updatePrompt);
router.delete('/api/ai/prompts/:id', deletePrompt);
export default router;
