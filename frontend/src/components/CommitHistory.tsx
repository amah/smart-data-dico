import { useState, useEffect } from 'react';
import { useCommand } from '../kernel/useCommand';
import { CommitInfo } from '../types';

const CommitHistory = () => {
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revertLoading, setRevertLoading] = useState<string | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);
  const [revertSuccess, setRevertSuccess] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);
  const run = useCommand();

  useEffect(() => {
    fetchCommitHistory();
  }, [limit]);

  const fetchCommitHistory = async () => {
    try {
      setLoading(true);
      setError(null);

      const data = await run('data-dictionary.git.log', { limit });
      // The framework log endpoint returns an array of log entries directly
      setCommits(data as unknown as CommitInfo[]);
    } catch (err) {
      console.error('Error fetching commit history:', err);
      setError('Failed to load commit history. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleRevert = async (commitHash: string) => {
    try {
      setRevertLoading(commitHash);
      setRevertError(null);
      setRevertSuccess(null);

      const result = await run('data-dictionary.publish.revert', { commitHash });

      setRevertSuccess(`Successfully reverted to commit ${commitHash.substring(0, 7)}. New revert commit: ${(result.newCommitHash || '').substring(0, 7)}`);

      // Refresh commit history after revert
      fetchCommitHistory();
    } catch (err) {
      console.error(`Error reverting to commit ${commitHash}:`, err);
      setRevertError(`Failed to revert to commit ${commitHash.substring(0, 7)}. Please try again.`);
    } finally {
      setRevertLoading(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <div className="flex justify-between items-center mb-6">
          <h2 className="card-title text-2xl">Commit History</h2>
          
          <div className="form-control">
            <select 
              className="select select-bordered select-sm"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              <option value={10}>Last 10 commits</option>
              <option value={20}>Last 20 commits</option>
              <option value={50}>Last 50 commits</option>
              <option value={100}>Last 100 commits</option>
            </select>
          </div>
        </div>
        
        {revertSuccess && (
          <div className="alert alert-success mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{revertSuccess}</span>
          </div>
        )}
        
        {revertError && (
          <div className="alert alert-error mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{revertError}</span>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        ) : error ? (
          <div className="alert alert-error">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        ) : commits.length === 0 ? (
          <div className="alert alert-info">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span>No commit history found. Make your first commit to start tracking changes.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-zebra w-full">
              <thead>
                <tr>
                  <th>Commit</th>
                  <th>Message</th>
                  <th>Author</th>
                  <th>Date</th>
                  <th>Changes</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {commits.map((commit) => (
                  <tr key={commit.hash} className="hover">
                    <td className="font-mono">{commit.hash.substring(0, 7)}</td>
                    <td className="max-w-xs truncate">{commit.message}</td>
                    <td>{commit.author}</td>
                    <td>{formatDate(commit.date)}</td>
                    <td>
                      {commit.changes && (
                        <div className="flex flex-col gap-1">
                          {commit.changes.added.length > 0 && (
                            <span className="text-success text-sm">
                              +{commit.changes.added.length} added
                            </span>
                          )}
                          {commit.changes.modified.length > 0 && (
                            <span className="text-warning text-sm">
                              ~{commit.changes.modified.length} modified
                            </span>
                          )}
                          {commit.changes.deleted.length > 0 && (
                            <span className="text-error text-sm">
                              -{commit.changes.deleted.length} deleted
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => handleRevert(commit.hash)}
                          disabled={!!revertLoading}
                        >
                          {revertLoading === commit.hash ? (
                            <span className="loading loading-spinner loading-xs"></span>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                            </svg>
                          )}
                          Revert
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            // Open a modal or navigate to a page showing commit details
                            // For now, we'll just log the commit hash
                            console.log('View commit details:', commit.hash);
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                          </svg>
                          Details
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default CommitHistory;