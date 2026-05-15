import { Router } from 'express';
import {
  listRules,
  getRule,
  getRulesForEntity,
  createRule,
  updateRule,
  deleteRule,
} from '../../controllers/ruleController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
// Rule API (#74)
router.get('/api/rules', listRules);
router.get('/api/rules/:uuid', getRule);
router.post('/api/rules', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createRule);
router.put('/api/rules/:uuid', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateRule);
router.delete('/api/rules/:uuid', authorizeJwt([UserRole.ADMIN]), deleteRule);
// Cross-boundary: owned by ruleController despite /api/entities/** URL prefix
router.get('/api/entities/:entityUuid/rules', getRulesForEntity);
export default router;
