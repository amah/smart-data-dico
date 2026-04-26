import { useState, useEffect } from 'react';
import { gitApi, versionApi } from '../services/api';
import Breadcrumbs from '../components/Breadcrumbs';
import { PageHeader } from '../components/ui';

export default function SavePublishPage() {
  const [status, setStatus] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchStatus = async () => {
    try {
      const data = await gitApi.getStatus();
      setStatus(data);
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  const changedFiles = status?.files || [];
  const unsavedCount = changedFiles.length;
  const branchInfo = typeof status?.branch === 'object' ? status.branch : null;
  const ahead = branchInfo?.ahead || status?.ahead || 0;
  const currentBranch = branchInfo?.current || (typeof status?.branch === 'string' ? status.branch : status?.current) || 'main';

  const handleSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      const commitMessage = message.trim() || `Updated data dictionary — ${unsavedCount} file${unsavedCount !== 1 ? 's' : ''} changed`;
      await versionApi.commitChanges(commitMessage);
      setResult({ type: 'success', text: 'Changes saved successfully.' });
      setMessage('');
      fetchStatus();
    } catch (err: any) {
      setResult({ type: 'error', text: err.response?.data?.message || 'Failed to save.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    setResult(null);
    try {
      await gitApi.push();
      setResult({ type: 'success', text: 'Published to shared repository.' });
      fetchStatus();
    } catch (err: any) {
      setResult({ type: 'error', text: err.response?.data?.message || 'Failed to publish. Try syncing first.' });
    } finally {
      setPublishing(false);
    }
  };

  const handleSync = async () => {
    setResult(null);
    try {
      await gitApi.pull();
      setResult({ type: 'success', text: 'Synced with shared repository.' });
      fetchStatus();
    } catch (err: any) {
      setResult({ type: 'error', text: err.response?.data?.message || 'Failed to sync.' });
    }
  };

  return (
    <div className="px-4 pt-2 pb-4 max-w-2xl space-y-4">
      <PageHeader
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: 'Home', path: '/' },
              { label: 'Save & Publish', path: '/save-publish' },
            ]}
          />
        }
      />

      {result && (
        <div className={`alert ${result.type === 'success' ? 'alert-success' : 'alert-error'}`}>
          <span>{result.text}</span>
        </div>
      )}

      {/* Status summary */}
      <div className="stats shadow w-full">
        <div className="stat">
          <div className="stat-title">Unsaved Changes</div>
          <div className={`stat-value text-lg ${unsavedCount > 0 ? 'text-warning' : 'text-success'}`}>
            {unsavedCount}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Saves Ahead</div>
          <div className={`stat-value text-lg ${ahead > 0 ? 'text-info' : ''}`}>
            {ahead}
          </div>
          <div className="stat-desc">Not yet published</div>
        </div>
        <div className="stat">
          <div className="stat-title">Workspace</div>
          <div className="stat-value text-lg font-mono">{currentBranch}</div>
        </div>
      </div>

      {/* Changed files */}
      {unsavedCount > 0 && (
        <div className="card bg-base-200">
          <div className="card-body p-4">
            <h3 className="font-semibold">Changed Files</h3>
            <ul className="space-y-1 mt-2">
              {changedFiles.map((f: any, i: number) => (
                <li key={i} className="text-sm flex gap-2">
                  <span className={`badge badge-xs ${f.status === 'added' || f.working_dir === '?' ? 'badge-success' : f.status === 'deleted' ? 'badge-error' : 'badge-warning'}`}>
                    {f.status || f.working_dir || 'M'}
                  </span>
                  <span className="font-mono">{f.path || f}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Save section */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-semibold">Save Changes</h3>
          <p className="text-sm text-base-content/70">Save creates a checkpoint of your current changes.</p>
          <textarea
            className="textarea textarea-bordered textarea-sm mt-2"
            placeholder="Describe what changed (optional)..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
          />
          <button
            className="btn btn-primary btn-sm mt-2 w-fit"
            onClick={handleSave}
            disabled={saving || unsavedCount === 0}
          >
            {saving && <span className="loading loading-spinner loading-xs" />}
            Save {unsavedCount > 0 ? `(${unsavedCount} changes)` : ''}
          </button>
        </div>
      </div>

      {/* Publish section */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-semibold">Publish & Sync</h3>
          <p className="text-sm text-base-content/70">Publish shares your saved changes with the team. Sync pulls the latest from the team.</p>
          <div className="flex gap-2 mt-2">
            <button
              className="btn btn-sm btn-primary"
              onClick={handlePublish}
              disabled={publishing || ahead === 0}
            >
              {publishing && <span className="loading loading-spinner loading-xs" />}
              Publish ({ahead} save{ahead !== 1 ? 's' : ''})
            </button>
            <button className="btn btn-sm btn-ghost" onClick={handleSync}>
              Sync from Team
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
