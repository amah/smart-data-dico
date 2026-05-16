import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCommand } from '../kernel/useCommand';

const CommitChanges = () => {
  const [commitMessage, setCommitMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const navigate = useNavigate();
  const run = useCommand();

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!commitMessage.trim()) {
      setError('Commit message is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      const result = await run('data-dictionary.publish.save', { message: commitMessage });

      setSuccess(`Changes committed successfully. Commit hash: ${result.commitHash || 'unknown'}`);
      setCommitMessage('');
      
      // After a successful commit, wait a bit and then navigate to history
      setTimeout(() => {
        navigate('/version/history');
      }, 2000);
    } catch (err) {
      console.error('Error committing changes:', err);
      setError('Failed to commit changes. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title text-2xl mb-6">Commit Changes</h2>
        
        {error && (
          <div className="alert alert-error mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}
        
        {success && (
          <div className="alert alert-success mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{success}</span>
          </div>
        )}
        
        <form onSubmit={handleCommit}>
          <div className="form-control">
            <label className="label">
              <span className="label-text">Commit Message</span>
            </label>
            <textarea 
              className="textarea textarea-bordered h-24"
              placeholder="Describe the changes you've made..."
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              required
            ></textarea>
            <label className="label">
              <span className="label-text-alt">
                Write a clear and descriptive message explaining the changes you've made.
              </span>
            </label>
          </div>
          
          <div className="alert alert-info mt-6 mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <div>
              <p className="font-medium">Committing will save all changes to the data dictionary.</p>
              <p className="text-sm mt-1">This creates a new version that can be reverted to later if needed.</p>
            </div>
          </div>
          
          <div className="card-actions justify-end mt-6">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => navigate('/version/history')}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Committing...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Commit Changes
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CommitChanges;