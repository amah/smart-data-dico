import { Request, Response } from 'express';
import { versionService } from '../services/versionService';
import { logger } from '../utils/logger';

/**
 * @swagger
 * /api/commit:
 *   post:
 *     summary: Commit changes to the local git repository
 *     description: Creates a new commit with all pending changes
 *     tags: [Version Control]
 *     security:
 *       - basicAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 description: Commit message
 *     responses:
 *       200:
 *         description: Changes committed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Changes committed successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     commitHash:
 *                       type: string
 *                       description: Hash of the new commit
 *                     commitMessage:
 *                       type: string
 *                       description: Commit message
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                       description: Timestamp of the commit
 *       400:
 *         description: Failed to commit changes
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 *
 * @param req Express request
 * @param res Express response
 */
export const commitChanges = async (req: Request, res: Response) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ message: 'Commit message is required' });
    }
    
    const result = await versionService.commitChanges(message);
    
    if (!result.success) {
      return res.status(400).json({ 
        message: 'Failed to commit changes', 
        errors: result.errors 
      });
    }
    
    res.json({ 
      message: 'Changes committed successfully',
      data: {
        commitHash: result.commitHash,
        commitMessage: message,
        timestamp: result.timestamp
      }
    });
  } catch (error) {
    logger.error(`Error committing changes: ${error}`);
    res.status(500).json({ message: 'Error committing changes', error });
  }
};

/**
 * @swagger
 * /api/history:
 *   get:
 *     summary: Get commit history
 *     description: Returns the commit history for the repository
 *     tags: [Version Control]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of commits to return
 *     responses:
 *       200:
 *         description: Commit history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Success
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/CommitInfo'
 *       500:
 *         description: Server error
 *
 * @param req Express request
 * @param res Express response
 */
export const getCommitHistory = async (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const limitNum = limit ? parseInt(limit as string, 10) : 10;
    
    const history = await versionService.getCommitHistory(limitNum);
    
    res.json({
      message: 'Success',
      data: history
    });
  } catch (error) {
    logger.error(`Error fetching commit history: ${error}`);
    res.status(500).json({ message: 'Error fetching commit history', error });
  }
};

/**
 * @swagger
 * /api/revert:
 *   post:
 *     summary: Revert to a previous commit
 *     description: Creates a new commit that reverts the changes in the specified commit
 *     tags: [Version Control]
 *     security:
 *       - basicAuth: []
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Successfully reverted to commit
 *                 data:
 *                   type: object
 *                   properties:
 *                     commitHash:
 *                       type: string
 *                       description: Hash of the reverted commit
 *                     newCommitHash:
 *                       type: string
 *                       description: Hash of the new revert commit
 *       400:
 *         description: Failed to revert to commit
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Server error
 *
 * @param req Express request
 * @param res Express response
 */
export const revertToCommit = async (req: Request, res: Response) => {
  try {
    const { commitHash } = req.body;
    
    if (!commitHash) {
      return res.status(400).json({ message: 'Commit hash is required' });
    }
    
    const result = await versionService.revertToCommit(commitHash);
    
    if (!result.success) {
      return res.status(400).json({ 
        message: 'Failed to revert to commit', 
        errors: result.errors 
      });
    }
    
    res.json({ 
      message: 'Successfully reverted to commit',
      data: {
        commitHash,
        newCommitHash: result.newCommitHash
      }
    });
  } catch (error) {
    logger.error(`Error reverting to commit: ${error}`);
    res.status(500).json({ message: 'Error reverting to commit', error });
  }
};