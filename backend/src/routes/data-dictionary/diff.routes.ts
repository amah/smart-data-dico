import { Router } from 'express';
import {
  logicalDiff,
  physicalDiff,
  impactDiffEndpoint,
  exportMigration,
  physicalDiffAll,
  impactDiffAll,
  exportMigrationAll,
  getPhysicalConfigController,
  putPhysicalConfigController,
  deletePhysicalConfigController,
} from '../../controllers/diffController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
// Diff API (#86, #88) — model comparison
router.post('/api/diff/logical', logicalDiff);
router.post('/api/diff/physical', physicalDiff);
router.post('/api/diff/impact', impactDiffEndpoint);
router.post('/api/export/migration', exportMigration);
// Whole-model (all-services) diff endpoints
router.post('/api/diff/physical/all', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), physicalDiffAll);
router.post('/api/diff/impact/all', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), impactDiffAll);
router.post('/api/export/migration/all', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), exportMigrationAll);
// Per-service physical config (non-secret persisted dialect + connection)
router.get('/api/services/:service/physical-config', getPhysicalConfigController);
router.put('/api/services/:service/physical-config', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), putPhysicalConfigController);
router.delete('/api/services/:service/physical-config', authorizeJwt([UserRole.ADMIN]), deletePhysicalConfigController);
export default router;
