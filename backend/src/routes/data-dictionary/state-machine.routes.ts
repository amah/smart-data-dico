/**
 * State machine routes (#179).
 *
 * GET    /api/entities/:uuid/state-machines  — list all machines for an entity
 * POST   /api/state-machines                 — create a new state machine
 * GET    /api/state-machines/:uuid           — get one machine by UUID
 * PUT    /api/state-machines/:uuid           — update a machine
 * DELETE /api/state-machines/:uuid           — delete a machine (ADMIN only)
 */

import { Router } from 'express';
import {
  listStateMachinesForEntity,
  getStateMachine,
  createStateMachine,
  updateStateMachine,
  deleteStateMachine,
} from '../../controllers/stateMachineController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();

// Entity-scoped listing
router.get('/api/entities/:uuid/state-machines', listStateMachinesForEntity);

// State machine CRUD
router.get('/api/state-machines/:uuid', getStateMachine);
router.post('/api/state-machines', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createStateMachine);
router.put('/api/state-machines/:uuid', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateStateMachine);
router.delete('/api/state-machines/:uuid', authorizeJwt([UserRole.ADMIN]), deleteStateMachine);

export default router;
