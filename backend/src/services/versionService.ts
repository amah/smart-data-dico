import simpleGit, { SimpleGit } from 'simple-git';
import path from 'path';
import { logger } from '../utils/logger.js';

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

/**
 * Service for version control operations
 */
export class VersionService {
  private git: SimpleGit;
  private repoPath: string;

  constructor() {
    this.repoPath = process.cwd();
    this.git = simpleGit(this.repoPath);
  }

  /**
   * Commit all changes to the repository
   * @param message Commit message
   * @returns Result of the commit operation
   */
  async commitChanges(message: string): Promise<{ 
    success: boolean; 
    errors: string[]; 
    commitHash?: string;
    timestamp?: Date;
  }> {
    try {
      // Check if we're in a git repository
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        return {
          success: false,
          errors: ['Not a git repository']
        };
      }

      // Check if there are any changes to commit
      const status = await this.git.status();
      if (status.files.length === 0) {
        return {
          success: false,
          errors: ['No changes to commit']
        };
      }

      // Add all changes
      await this.git.add('.');
      
      // Commit changes
      const commitResult = await this.git.commit(message);
      
      if (!commitResult.commit) {
        return {
          success: false,
          errors: ['Failed to create commit']
        };
      }

      logger.info(`Changes committed: ${commitResult.commit}`);
      
      return {
        success: true,
        errors: [],
        commitHash: commitResult.commit,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error(`Error committing changes: ${error}`);
      return {
        success: false,
        errors: [`Error committing changes: ${error}`]
      };
    }
  }

  /**
   * Get commit history
   * @param limit Maximum number of commits to retrieve
   * @returns Array of commit information
   */
  async getCommitHistory(limit: number = 10): Promise<CommitInfo[]> {
    try {
      // Check if we're in a git repository
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        return [];
      }

      // Get commit history
      const logOptions = {
        '--max-count': limit.toString(),
        '--pretty': 'format:{"hash":"%H","date":"%aI","message":"%s","author_name":"%an","author_email":"%ae"}'
      };
      
      const logResult = await this.git.log(logOptions);
      
      // Parse the log output
      const commits: CommitInfo[] = [];
      
      if (logResult.all && logResult.all.length > 0) {
        for (const commit of logResult.all) {
          commits.push({
            hash: commit.hash,
            date: commit.date,
            message: commit.message,
            author_name: commit.author_name,
            author_email: commit.author_email
          });
        }
      }
      
      return commits;
    } catch (error) {
      logger.error(`Error getting commit history: ${error}`);
      return [];
    }
  }

  /**
   * Revert to a previous commit
   * @param commitHash Hash of the commit to revert to
   * @returns Result of the revert operation
   */
  async revertToCommit(commitHash: string): Promise<{ 
    success: boolean; 
    errors: string[]; 
    newCommitHash?: string;
  }> {
    try {
      // Check if we're in a git repository
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        return {
          success: false,
          errors: ['Not a git repository']
        };
      }

      // Check if the commit exists
      try {
        await this.git.show([commitHash]);
      } catch (error) {
        return {
          success: false,
          errors: [`Commit ${commitHash} not found`]
        };
      }

      // Create a revert commit
      const revertResult = await this.git.revert(commitHash);
      
      // Get the hash of the new revert commit
      const logResult = await this.git.log({ '-n': 1 });
      const newCommitHash = logResult.latest?.hash;
      
      logger.info(`Reverted to commit ${commitHash}, created new commit ${newCommitHash}`);
      
      return {
        success: true,
        errors: [],
        newCommitHash
      };
    } catch (error) {
      logger.error(`Error reverting to commit: ${error}`);
      return {
        success: false,
        errors: [`Error reverting to commit: ${error}`]
      };
    }
  }
}

// Export a singleton instance
export const versionService = new VersionService();