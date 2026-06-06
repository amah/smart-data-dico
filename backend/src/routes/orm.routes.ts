import { Router, type Request, type Response } from 'express';
import { ORM_VOCABULARY, ORM_PREFIX } from '../models/ormVocabulary.js';

const router: Router = Router();

/**
 * GET /api/orm/vocabulary
 *
 * The reserved `orm.*` metadata vocabulary (single source of truth in
 * models/ormVocabulary.ts). The frontend uses this to render typed ORM-mapping
 * editors with the same keys/values the validator enforces.
 */
router.get('/api/orm/vocabulary', (_req: Request, res: Response) => {
  res.json({ data: { prefix: ORM_PREFIX, scopes: ORM_VOCABULARY } });
});

export default router;
