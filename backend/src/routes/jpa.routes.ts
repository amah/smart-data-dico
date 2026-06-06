import { Router, type Request, type Response } from 'express';
import { JPA_VOCABULARY, JPA_PREFIX } from '../models/jpaVocabulary.js';

const router: Router = Router();

/**
 * GET /api/jpa/vocabulary
 *
 * The reserved `jpa.*` metadata vocabulary (single source of truth in
 * models/jpaVocabulary.ts). The frontend uses this to render typed JPA-mapping
 * editors with the same keys/values the validator enforces.
 */
router.get('/api/jpa/vocabulary', (_req: Request, res: Response) => {
  res.json({ data: { prefix: JPA_PREFIX, scopes: JPA_VOCABULARY } });
});

export default router;
