import { Router } from 'express';
import {
  createDictionary,
  getDictionaries,
  getDictionaryById,
  getDictionaryEntries,
  getPackageByPath,
  getPackageHierarchy,
  getTabularData,
  listAllPackagesAndEntities,
  createRootPackage,
  createPackageAtPath,
  updatePackageAtPath,
  deletePackageAtPath,
} from '../../controllers/dictionaryController.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';

const router: Router = Router();
// Literals first
router.get('/api/packages/all', listAllPackagesAndEntities);
router.get('/api/packages/hierarchy/:rootPackage', getPackageHierarchy);
router.get('/api/packages/tabular/:rootPackage', getTabularData);
// Mutations
router.post('/api/packages', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createRootPackage);
router.post('/api/packages/:rootPackage/subpackages/*', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), createPackageAtPath);
router.put('/api/packages/:rootPackage/path/*', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), updatePackageAtPath);
router.delete('/api/packages/:rootPackage/path/*', authorizeJwt([UserRole.ADMIN]), deletePackageAtPath);
router.get('/api/packages/:rootPackage/path/*', getPackageByPath);
// Legacy /api/dictionaries/** (same controller)
router.get('/api/dictionaries', getDictionaries);
router.post('/api/dictionaries', createDictionary);
router.get('/api/dictionaries/:id', getDictionaryById);
router.get('/api/dictionaries/:id/entries', getDictionaryEntries);
export default router;
