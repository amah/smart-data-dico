/**
 * Action routes (#179).
 *
 * GET    /api/entities/:uuid/actions   — list all actions for an entity
 * POST   /api/actions                  — create a new action
 * GET    /api/actions/:uuid            — get one action by UUID
 * PUT    /api/actions/:uuid            — update an action
 * DELETE /api/actions/:uuid            — delete an action (ADMIN only)
 */

import { Router } from 'express';
import {
  listActionsForEntity,
  getAction,
  createAction,
  updateAction,
  deleteAction,
} from '../../controllers/actionController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();

// Entity-scoped listing — mirrors GET /api/entities/:entityUuid/rules
router.get('/api/entities/:uuid/actions', listActionsForEntity);

// Action CRUD
router.get('/api/actions/:uuid', getAction);
router.post('/api/actions', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createAction);
router.put('/api/actions/:uuid', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateAction);
router.delete('/api/actions/:uuid', authorizeJwt([UserRole.ADMIN]), deleteAction);

export default router;
