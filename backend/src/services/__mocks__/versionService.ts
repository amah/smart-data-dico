// Mock version service matching actual VersionService API
class VersionServiceMock {
  async commitChanges(message: string) {
    return {
      success: true,
      errors: [] as string[],
      commitHash: 'mock-commit-hash-abc123',
      timestamp: new Date('2026-01-01T12:00:00Z'),
    };
  }

  async getCommitHistory(limit: number = 10) {
    return [
      {
        hash: 'mock-commit-1',
        message: 'Initial commit',
        author: 'Test User',
        date: '2023-01-01T12:00:00Z',
      },
      {
        hash: 'mock-commit-2',
        message: 'Update User entity',
        author: 'Test User',
        date: '2023-01-02T12:00:00Z',
      },
    ];
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
