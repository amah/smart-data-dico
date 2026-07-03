import { Router } from 'express';
import {
  getDerivedTypes, putDerivedTypes, getHideRules, putHideRules,
  getElementStyles, putElementStyles, getStyleRules, putStyleRules,
} from '../../controllers/dicoConfigController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
const WRITE = authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]);
// Derived data types (#107) — stored under `dico.config.json.types[]`
router.get('/api/config/types', getDerivedTypes);
router.put('/api/config/types', WRITE, putDerivedTypes);
// Hide rules (#hide-model-data) — stored under `dico.config.json.hideRules[]`
router.get('/api/config/hide-rules', getHideRules);
router.put('/api/config/hide-rules', WRITE, putHideRules);
// Element styles + style rules (#element-style) — `dico.config.json.elementStyles[]`/`styleRules[]`
router.get('/api/config/element-styles', getElementStyles);
router.put('/api/config/element-styles', WRITE, putElementStyles);
router.get('/api/config/style-rules', getStyleRules);
router.put('/api/config/style-rules', WRITE, putStyleRules);
export default router;
