// Mock version service
class VersionServiceMock {
  async commitChanges(message: string, author: string) {
    return {
      commitId: 'mock-commit-id',
      message,
      author,
      timestamp: new Date().toISOString(),
      success: true
    };
  }

  async getCommitHistory() {
    return [
      {
        commitId: 'mock-commit-1',
        message: 'Initial commit',
        author: 'Test User',
        timestamp: '2023-01-01T12:00:00Z'
      },
      {
        commitId: 'mock-commit-2',
        message: 'Update User entity',
        author: 'Test User',
        timestamp: '2023-01-02T12:00:00Z'
      },
      {
        commitId: 'mock-commit-3',
        message: 'Add Product entity',
        author: 'Test User',
        timestamp: '2023-01-03T12:00:00Z'
      }
    ];
  }

  async revertToCommit(commitId: string) {
    return {
      success: true,
      commitId,
      message: `Reverted to commit ${commitId}`
    };
  }
}

export const versionService = new VersionServiceMock();