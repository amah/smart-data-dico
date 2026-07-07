import { Router } from 'express';
import { searchEntities } from '../controllers/serviceController.js';
import { getFlatEntitiesAndAttributes } from '../controllers/dictionaryController.js';
import { registerSearchAgentTools } from '../services/search/agentTools.js';

// Contribute the read-only `searchModel` tool to the AI agent (#search-index).
// Registered at module load, mirroring elementStyle / reverse-engineer.
registerSearchAgentTools();

const router: Router = Router();
// /api/entities/flat MUST be declared before any 2-segment /api/entities POST
// at the same router level. Here they are in different routers but with
// different segment counts (3 vs 2), so Express does not collide them.
router.get('/api/entities/flat', getFlatEntitiesAndAttributes);
router.get('/api/search', searchEntities);
export default router;
