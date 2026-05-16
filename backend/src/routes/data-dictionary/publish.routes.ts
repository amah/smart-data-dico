import { Router, type Request, type Response } from 'express';
import { versionService } from '../../services/versionService.js';
import { UserRole } from '../../middleware/auth.js';
import { authorizeJwt } from '../../middleware/jwtAuth.js';
import { logger } from '../../utils/logger.js';

const router: Router = Router();

/**
 * @swagger
 * /api/revert:
 *   post:
 *     summary: Revert to a previous commit
 *     description: Creates a new commit that reverts the changes in the specified commit
 *     tags: [Publish]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - commitHash
 *             properties:
 *               commitHash:
 *                 type: string
 *                 description: Hash of the commit to revert
 *     responses:
 *       200:
 *         description: Successfully reverted to commit
 *       400:
 *         description: Failed to revert to commit
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 */
router.post('/api/revert', authorizeJwt([UserRole.ADMIN]), async (req: Request, res: Response) => {
  try {
    const { commitHash } = req.body;

    if (!commitHash) {
      return res.status(400).json({ message: 'Commit hash is required' });
    }

    const result = await versionService.revertToCommit(commitHash);

    if (!result.success) {
      return res.status(400).json({
        message: 'Failed to revert to commit',
        errors: result.errors,
      });
    }

    res.json({
      message: 'Successfully reverted to commit',
      data: {
        commitHash,
        newCommitHash: result.newCommitHash,
      },
    });
  } catch (error) {
    logger.error(`Error reverting to commit: ${error}`);
    res.status(500).json({ message: 'Error reverting to commit', error });
  }
});

export default router;
