/**
 * Event routes (#201 Phase 2).
 *
 * GET    /api/events                  — list all events (optional ?package=)
 * GET    /api/entities/:uuid/events   — list events owned by an entity
 * POST   /api/events                  — create a new event
 * GET    /api/events/:uuid            — get one event by UUID
 * PUT    /api/events/:uuid            — update an event
 * DELETE /api/events/:uuid            — delete an event (ADMIN only)
 */

import { Router } from 'express';
import {
  listEvents,
  listEventsForEntity,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
} from '../../controllers/eventController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();

// Listing
router.get('/api/events', listEvents);
router.get('/api/entities/:uuid/events', listEventsForEntity);

// Event CRUD
router.get('/api/events/:uuid', getEvent);
router.post('/api/events', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createEvent);
router.put('/api/events/:uuid', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateEvent);
router.delete('/api/events/:uuid', authorizeJwt([UserRole.ADMIN]), deleteEvent);

export default router;
