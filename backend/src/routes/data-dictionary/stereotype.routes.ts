import { Router } from 'express';
import {
  getAllStereotypes,
  getStereotype,
  createStereotype,
  updateStereotype,
  deleteStereotype,
} from '../../controllers/stereotypeController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
// Stereotype API
router.get('/api/stereotypes', getAllStereotypes);
router.get('/api/stereotypes/:id', getStereotype);
router.post('/api/stereotypes', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createStereotype);
router.put('/api/stereotypes/:id', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updateStereotype);
router.delete('/api/stereotypes/:id', authorizeJwt([UserRole.ADMIN]), deleteStereotype);
export default router;
