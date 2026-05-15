import { Router } from 'express';
import { getIntegrityReport } from '../../controllers/integrityController.js';

const router: Router = Router();
// Integrity API (#85 R5) — unified validation + constraints + rules report
router.get('/api/integrity', getIntegrityReport);
export default router;
