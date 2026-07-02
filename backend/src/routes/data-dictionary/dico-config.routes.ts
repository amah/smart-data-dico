import { Router } from 'express';
import { getDerivedTypes, putDerivedTypes, getHideRules, putHideRules } from '../../controllers/dicoConfigController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
// Derived data types (#107) — stored under `dico.config.json.types[]`
router.get('/api/config/types', getDerivedTypes);
router.put('/api/config/types', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), putDerivedTypes);
// Hide rules (#hide-model-data) — stored under `dico.config.json.hideRules[]`
router.get('/api/config/hide-rules', getHideRules);
router.put('/api/config/hide-rules', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), putHideRules);
export default router;
