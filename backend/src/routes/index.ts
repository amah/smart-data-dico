import { Router } from 'express';
import authRoutes from './auth.routes.js';
import dataDictionaryRoutes from './data-dictionary/index.js';
import aiRoutes from './ai/index.js';
import searchRoutes from './search.routes.js';
import visualizationRoutes from './visualization.routes.js';
import statusRoutes from './status.routes.js';
import projectRoutes from './project.routes.js';
import ormRoutes from './orm.routes.js';
import sqlRoutes from './sql.routes.js';

const router: Router = Router();
router.use(statusRoutes);
router.use(authRoutes);
router.use(searchRoutes);          // mounted before data-dictionary so `/api/entities/flat` is visible at the same level
router.use(visualizationRoutes);
router.use(projectRoutes);
router.use(ormRoutes);
router.use(dataDictionaryRoutes);
router.use(aiRoutes);
router.use(sqlRoutes);
export default router;
