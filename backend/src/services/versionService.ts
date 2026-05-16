import { logger } from '../utils/logger.js';
import { config } from '../kernel/config.js';

// Lazy-loaded git service from @hamak/ui-remote-git-fs-backend
let gitServiceInstance: any = null;

async function getGitService() {
  if (gitServiceInstance) return gitServiceInstance;
  try {
    const gitModule = await import('@hamak/ui-remote-git-fs-backend');
    const workspaceRoots = new Map<string, string>([
      ['dictionaries', config.dataDir],
    ]);
    gitServiceInstance = gitModule.createGitService(workspaceRoots);
    return gitServiceInstance;
  } catch {
    logger.warn('Git service not available');
    return null;
  }
}

/**
 * Service for version control operations using @hamak/ui-remote-git-fs-backend.
 *
 * Slimmed to two methods in #160:
 *   - getWorkingTreeStatus  — still consumed by project.routes.ts (#95)
 *   - revertToCommit        — consumed by publish.routes.ts (kept one
 *     release until the upstream framework lands a revert op)
 *
 * The legacy commit and history methods were deleted; those endpoints are now
 * served by the framework's /api/git routes (via GitService on the frontend).
 */
export class VersionService {
  /**
   * Return the dirty state of the data-dictionary subtree (#95).
   * Used to warn before switching/closing a project.
   */
  async getWorkingTreeStatus(): Promise<{ clean: boolean; files: string[] }> {
    try {
      const gitService = await getGitService();
      if (!gitService) return { clean: true, files: [] };
      const status = await gitService.getStatus('dictionaries', '.');
      const dataDirName = config.dataDir.split('/').pop() || 'data-dictionaries';
      const ddPrefix = dataDirName + '/';
      const ddFiles: string[] = (status.files || [])
        .map((f: any) => f.path as string)
        .filter((p: string) => p.startsWith(ddPrefix));
      return { clean: ddFiles.length === 0, files: ddFiles };
    } catch (error) {
      logger.warn(`getWorkingTreeStatus failed: ${error}`);
      return { clean: true, files: [] };
    }
  }

  /**
   * Revert to a previous commit
   */
  async revertToCommit(commitHash: string): Promise<{
    success: boolean;
    errors: string[];
    newCommitHash?: string;
  }> {
    try {
      const gitService = await getGitService();
      if (!gitService) {
        return { success: false, errors: ['Git service not available'] };
      }

      const result = await gitService.revert('dictionaries', '.', { commit: commitHash });

      logger.info(`Reverted to commit ${commitHash}`);

      return {
        success: true,
        errors: [],
        newCommitHash: result?.hash,
      };
    } catch (error) {
      logger.error(`Error reverting to commit: ${error}`);
      return {
        success: false,
        errors: [`Error reverting to commit: ${error}`],
      };
    }
  }
}

// Export a singleton instance
export const versionService = new VersionService();
