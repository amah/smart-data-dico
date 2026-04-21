import { logger } from '../utils/logger.js';
import { config } from '../kernel/config.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
   * Get commit history at the project's data dir (#110).
   *
   * Uses raw `git log` at `config.dataDir` instead of the hamak git
   * service's `log`: the service returns an empty list in our setup (the
   * project lives as a subfolder of a larger repo), and the fix is in
   * upstream hamak-land. Shelling out is also faster for read-only
   * listing since we skip the adapter layer entirely.
   *
   * `--follow` is deliberately absent — we want commits that touch the
   * project folder, not one specific file. `-n <limit>` caps output.
   */
  async getCommitHistory(limit: number = 10): Promise<CommitInfo[]> {
    // Tab-separated fields + newline-separated records. Commit messages
    // can contain tabs in theory, so we also cap `%s` (subject only, no
    // body), and split on the first N-1 tabs per line.
    try {
      // No path filter — the diff UI wants to browse the repo's recent
      // history as a whole; a user might pick a commit that didn't touch
      // the project folder and still want to diff against it.
      const { stdout } = await execAsync(
        'git log --format=%H%x09%ai%x09%an%x09%ae%x09%s -n ' + limit,
        { cwd: config.dataDir, maxBuffer: 10 * 1024 * 1024 },
      );
      return stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const parts = line.split('\t');
          return {
            hash: parts[0] || '',
            date: parts[1] || '',
            author_name: parts[2] || '',
            author_email: parts[3] || '',
            message: parts.slice(4).join('\t'),
          };
        });
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
