import { logger } from '../utils/logger.js';
import { config } from '../kernel/config.js';

/**
 * Interface for commit information
 */
interface CommitInfo {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  author_email: string;
}

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
 * Service for version control operations using @hamak/ui-remote-git-fs-backend
 */
export class VersionService {
  /**
   * Commit all changes to the repository
   */
  async commitChanges(message: string): Promise<{
    success: boolean;
    errors: string[];
    commitHash?: string;
    timestamp?: Date;
  }> {
    try {
      const gitService = await getGitService();
      if (!gitService) {
        return { success: false, errors: ['Git service not available'] };
      }

      const status = await gitService.getStatus('dictionaries', '.');
      if (!status.files || status.files.length === 0) {
        return { success: false, errors: ['No changes to commit'] };
      }

      // The workspace maps to a subdirectory (data-dictionaries/) but
      // getStatus returns paths relative to the git repo root. Filter
      // to data-dictionary files and strip the prefix so stage() can
      // resolve them inside the workspace.
      const dataDirName = config.dataDir.split('/').pop() || 'data-dictionaries';
      const ddPrefix = dataDirName + '/';
      const ddFiles = status.files
        .map((f: any) => f.path as string)
        .filter((p: string) => p.startsWith(ddPrefix))
        .map((p: string) => p.slice(ddPrefix.length));

      if (ddFiles.length === 0) {
        return { success: false, errors: ['No data dictionary changes to commit'] };
      }

      await gitService.stage('dictionaries', '.', ddFiles);

      const result = await gitService.commit('dictionaries', '.', message);

      logger.info(`Changes committed: ${result.hash || 'unknown'}`);

      return {
        success: true,
        errors: [],
        commitHash: result.hash,
        timestamp: new Date(),
      };
    } catch (error: any) {
      const msg = error?.message || JSON.stringify(error);
      logger.error(`Error committing changes: ${msg}`);
      return {
        success: false,
        errors: [`Error committing changes: ${msg}`],
      };
    }
  }

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
   * Get commit history
   */
  async getCommitHistory(limit: number = 10): Promise<CommitInfo[]> {
    try {
      const gitService = await getGitService();
      if (!gitService) return [];

      const logResult = await gitService.log('dictionaries', '.', { maxCount: limit });

      if (!logResult || !Array.isArray(logResult)) return [];

      return logResult.map((entry: any) => ({
        hash: entry.hash || entry.oid || '',
        date: entry.date || entry.timestamp || '',
        message: entry.message || '',
        author_name: entry.author_name || entry.author?.name || '',
        author_email: entry.author_email || entry.author?.email || '',
      }));
    } catch (error) {
      logger.error(`Error getting commit history: ${error}`);
      return [];
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
