import { Router } from 'express';
import packageRoutes from './package.routes.js';
import entityRoutes from './entity.routes.js';
import relationshipRoutes from './relationship.routes.js';
import stereotypeRoutes from './stereotype.routes.js';
import caseRoutes from './case.routes.js';
import ruleRoutes from './rule.routes.js';
import integrityRoutes from './integrity.routes.js';
import modelMetadataRoutes from './model-metadata.routes.js';
import dicoConfigRoutes from './dico-config.routes.js';
import diffRoutes from './diff.routes.js';
import importExportRoutes from './import-export.routes.js';
import publishRoutes from './publish.routes.js';
import actionRoutes from './action.routes.js';
import stateMachineRoutes from './state-machine.routes.js';

const router: Router = Router();
// Ordering: literals before :params within /api/packages/** and /api/entities/**.
// Mount specific-prefix routers (relationship under /api/packages/:packageName/relationships)
// AFTER package so package's literal /api/packages/all and /api/packages/hierarchy/...
// still match first. Express matches in order across stacked sub-routers.
router.use(packageRoutes);
router.use(relationshipRoutes);
router.use(entityRoutes);
router.use(stereotypeRoutes);
router.use(caseRoutes);
router.use(ruleRoutes);
router.use(integrityRoutes);
router.use(modelMetadataRoutes);
router.use(dicoConfigRoutes);
router.use(diffRoutes);
router.use(importExportRoutes);
router.use(publishRoutes);
router.use(actionRoutes);
router.use(stateMachineRoutes);
export default router;
