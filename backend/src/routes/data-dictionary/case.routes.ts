import { Router } from 'express';
import {
  getAllCases,
  getCase,
  createCase,
  updateCase,
  deleteCase,
  resolveCase,
  getCaseGraph,
  upsertCaseNode,
} from '../../controllers/caseController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
// Case API (#121 — renamed from Perspective)
router.get('/api/cases', getAllCases);
router.get('/api/cases/:id', getCase);
router.post('/api/cases', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createCase);
router.put('/api/cases/:id', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateCase);
router.delete('/api/cases/:id', authorizeJwt([UserRole.ADMIN]), deleteCase);
router.get('/api/cases/:id/resolve', resolveCase);
router.get('/api/cases/:id/graph', getCaseGraph);
router.put('/api/cases/:id/nodes', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), upsertCaseNode);
// Legacy alias — 308-redirects /api/perspectives/* to /api/cases/* for one release.
router.all('/api/perspectives*', (req, res) => {
  const target = '/api/cases' + req.path.replace('/api/perspectives', '');
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(308, target + query);
});
export default router;
