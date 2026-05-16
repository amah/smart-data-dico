// Mock version service — slimmed to match the #160 VersionService surface.
// Only getWorkingTreeStatus and revertToCommit survive after #160.
class VersionServiceMock {
  async getWorkingTreeStatus() {
    return { clean: true, files: [] as string[] };
  }

  async revertToCommit(commitHash: string) {
    return {
      success: true,
      errors: [] as string[],
      newCommitHash: 'mock-revert-hash-def456',
    };
  }
}

export const versionService = new VersionServiceMock();
