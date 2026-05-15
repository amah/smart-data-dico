import { Router } from 'express';
import { getGraphData, getImpactAnalysis, getLineage } from '../controllers/serviceController.js';
import { diagramController } from '../controllers/diagramController.js';
import { UserRole } from '../middleware/auth.js';
import { authorizeJwt } from '../middleware/jwtAuth.js';

const router: Router = Router();
// Graph API for visualization
router.get('/api/graph/:service', getGraphData);
// Impact analysis & lineage
router.get('/api/entities/:uuid/impact', getImpactAnalysis);
router.get('/api/entities/:uuid/lineage', getLineage);
// Diagram layout API
router.get('/api/diagrams', diagramController.listDiagramLayouts.bind(diagramController));
router.post('/api/diagrams', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), diagramController.saveDiagramLayout.bind(diagramController));
router.get('/api/diagrams/:id', diagramController.loadDiagramLayout.bind(diagramController));
router.put('/api/diagrams/:id', authorizeJwt([UserRole.ADMIN, UserRole.EDITOR]), diagramController.updateDiagramLayout.bind(diagramController));
router.delete('/api/diagrams/:id', authorizeJwt([UserRole.ADMIN]), diagramController.deleteDiagramLayout.bind(diagramController));
export default router;
