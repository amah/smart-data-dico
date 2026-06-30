/**
 * Reverse-engineer's Settings section (Jira + Confluence Server/DC config),
 * contributed to the Settings page via the settings-slot registry — so the
 * shared Settings.tsx carries no reverse-engineer-specific code.
 */
import { useEffect, useState } from 'react';
import { reverseEngineerApi } from '../../services/api';

export default function ReverseEngineerSettings() {
  // --- Jira (Server / Data Center) ---
  const [jiraBaseUrl, setJiraBaseUrl] = useState('');
  const [jiraAuthType, setJiraAuthType] = useState<'token' | 'basic'>('token');
  const [jiraToken, setJiraToken] = useState('');
  const [jiraTokenMask, setJiraTokenMask] = useState('');
  const [jiraUser, setJiraUser] = useState('');
  const [jiraPassword, setJiraPassword] = useState('');
  const [jiraHasPassword, setJiraHasPassword] = useState(false);
  const [jiraEnabled, setJiraEnabled] = useState(false);
  const [jiraSaving, setJiraSaving] = useState(false);
  const [jiraMessage, setJiraMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [jiraConfigPath, setJiraConfigPath] = useState('');

  useEffect(() => {
    reverseEngineerApi.getJiraConfig().then((c) => {
      setJiraBaseUrl(c.baseUrl || '');
      setJiraAuthType(c.authType || 'token');
      setJiraUser(c.user || '');
      setJiraTokenMask(c.token || '');
      setJiraHasPassword(c.hasPassword);
      setJiraEnabled(c.enabled);
      setJiraConfigPath(c.configPath || '');
    }).catch(() => { /* non-admin or not configured */ });
  }, []);

  const handleJiraSave = async () => {
    if (!jiraBaseUrl.trim()) { setJiraMessage({ type: 'error', text: 'Base URL is required' }); return; }
    setJiraSaving(true);
    setJiraMessage(null);
    try {
      await reverseEngineerApi.saveJiraConfig({ baseUrl: jiraBaseUrl, authType: jiraAuthType, user: jiraUser || undefined, token: jiraToken || undefined, password: jiraPassword || undefined, enabled: jiraEnabled });
      const c = await reverseEngineerApi.getJiraConfig();
      setJiraTokenMask(c.token || '');
      setJiraHasPassword(c.hasPassword);
      setJiraToken('');
      setJiraPassword('');
      setJiraMessage({ type: 'success', text: 'Jira configuration saved' });
    } catch (err: any) {
      setJiraMessage({ type: 'error', text: err.response?.data?.message || 'Failed to save' });
    } finally {
      setJiraSaving(false);
    }
  };

  const handleJiraTest = async () => {
    setJiraMessage(null);
    try {
      const r = await reverseEngineerApi.testJira();
      setJiraMessage(r.ok ? { type: 'success', text: `Connected as ${r.user}` } : { type: 'error', text: r.error || 'Failed' });
    } catch (err: any) {
      setJiraMessage({ type: 'error', text: err.response?.data?.error || 'Connection failed' });
    }
  };

  // --- Confluence (Server / Data Center) ---
  const [confBaseUrl, setConfBaseUrl] = useState('');
  const [confAuthType, setConfAuthType] = useState<'token' | 'basic'>('token');
  const [confToken, setConfToken] = useState('');
  const [confTokenMask, setConfTokenMask] = useState('');
  const [confUser, setConfUser] = useState('');
  const [confPassword, setConfPassword] = useState('');
  const [confHasPassword, setConfHasPassword] = useState(false);
  const [confSpaceKey, setConfSpaceKey] = useState('');
  const [confLimit, setConfLimit] = useState(50);
  const [confEnabled, setConfEnabled] = useState(false);
  const [confSaving, setConfSaving] = useState(false);
  const [confMessage, setConfMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    reverseEngineerApi.getConfluenceConfig().then((c) => {
      setConfBaseUrl(c.baseUrl || '');
      setConfAuthType(c.authType || 'token');
      setConfUser(c.user || '');
      setConfTokenMask(c.token || '');
      setConfHasPassword(c.hasPassword);
      setConfSpaceKey(c.spaceKey || '');
      setConfLimit(c.limit || 50);
      setConfEnabled(c.enabled);
    }).catch(() => { /* non-admin or not configured */ });
  }, []);

  const handleConfSave = async () => {
    if (!confBaseUrl.trim()) { setConfMessage({ type: 'error', text: 'Base URL is required' }); return; }
    setConfSaving(true);
    setConfMessage(null);
    try {
      await reverseEngineerApi.saveConfluenceConfig({ baseUrl: confBaseUrl, authType: confAuthType, user: confUser || undefined, token: confToken || undefined, password: confPassword || undefined, spaceKey: confSpaceKey || undefined, limit: confLimit, enabled: confEnabled });
      const c = await reverseEngineerApi.getConfluenceConfig();
      setConfTokenMask(c.token || '');
      setConfHasPassword(c.hasPassword);
      setConfToken('');
      setConfPassword('');
      setConfMessage({ type: 'success', text: 'Confluence configuration saved' });
    } catch (err: any) {
      setConfMessage({ type: 'error', text: err.response?.data?.message || 'Failed to save' });
    } finally {
      setConfSaving(false);
    }
  };

  const handleConfTest = async () => {
    setConfMessage(null);
    try {
      const r = await reverseEngineerApi.testConfluence();
      setConfMessage(r.ok ? { type: 'success', text: `Connected${r.space ? ' — ' + r.space : ''}` } : { type: 'error', text: r.error || 'Failed' });
    } catch (err: any) {
      setConfMessage({ type: 'error', text: err.response?.data?.error || 'Connection failed' });
    }
  };

  return (
    <div className="md:col-span-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Jira (Server / Data Center) — reverse-engineer enrichment */}
        <div className="md:col-span-2">
          <h2 className="text-xl font-bold mb-1 mt-4">Jira (Server / Data Center)</h2>
          <p className="text-sm opacity-70 mb-2">
            Enriches reverse-engineered models: tickets found in commit messages / Liquibase
            changeSet ids are fetched from Jira and attached to the elements they introduced.
          </p>
          {jiraConfigPath && (<p className="text-xs opacity-50 mb-3">Config file: <code>{jiraConfigPath}</code></p>)}
        </div>

        <div className="form-control">
          <label className="label"><span className="label-text">Base URL</span></label>
          <input type="text" className="input input-bordered w-full" placeholder="https://jira.mycompany.com" value={jiraBaseUrl} onChange={(e) => setJiraBaseUrl(e.target.value)} />
        </div>

        <div className="form-control">
          <label className="label"><span className="label-text">Auth</span></label>
          <select className="select select-bordered w-full" value={jiraAuthType} onChange={(e) => setJiraAuthType(e.target.value as 'token' | 'basic')}>
            <option value="token">Personal Access Token (Bearer)</option>
            <option value="basic">Username + Password (Basic)</option>
          </select>
        </div>

        {jiraAuthType === 'token' ? (
          <div className="form-control md:col-span-2">
            <label className="label"><span className="label-text">Personal Access Token</span></label>
            <input type="password" className="input input-bordered w-full" placeholder={jiraTokenMask ? `Saved (${jiraTokenMask}) — leave empty to keep` : 'Enter PAT'} value={jiraToken} onChange={(e) => setJiraToken(e.target.value)} />
          </div>
        ) : (
          <>
            <div className="form-control">
              <label className="label"><span className="label-text">Username</span></label>
              <input type="text" className="input input-bordered w-full" value={jiraUser} onChange={(e) => setJiraUser(e.target.value)} />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">Password</span></label>
              <input type="password" className="input input-bordered w-full" placeholder={jiraHasPassword ? 'Saved — leave empty to keep' : 'Enter password'} value={jiraPassword} onChange={(e) => setJiraPassword(e.target.value)} />
            </div>
          </>
        )}

        <div className="form-control md:col-span-2">
          <label className="label cursor-pointer justify-start gap-3">
            <input type="checkbox" className="toggle toggle-sm" checked={jiraEnabled} onChange={(e) => setJiraEnabled(e.target.checked)} />
            <span className="label-text">Enable Jira enrichment</span>
          </label>
        </div>

        <div className="md:col-span-2 flex items-center gap-3">
          <button type="button" className="btn btn-primary btn-sm" onClick={handleJiraSave} disabled={jiraSaving}>
            {jiraSaving ? <><span className="loading loading-spinner loading-xs"></span> Saving...</> : 'Save Jira Config'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleJiraTest}>Test connection</button>
          {jiraMessage && (<span className={`text-sm ${jiraMessage.type === 'success' ? 'text-success' : 'text-error'}`}>{jiraMessage.text}</span>)}
        </div>

        {/* Confluence (Server / Data Center) — reverse-engineer domain-doc dump */}
        <div className="md:col-span-2">
          <h2 className="text-xl font-bold mb-1 mt-4">Confluence (Server / Data Center)</h2>
          <p className="text-sm opacity-70 mb-2">
            Dumps a Confluence space into the local store as text, so the AI synthesis
            step has domain documentation to draw on when describing entities.
          </p>
        </div>

        <div className="form-control">
          <label className="label"><span className="label-text">Base URL</span></label>
          <input type="text" className="input input-bordered w-full" placeholder="https://wiki.mycompany.com" value={confBaseUrl} onChange={(e) => setConfBaseUrl(e.target.value)} />
        </div>

        <div className="form-control">
          <label className="label"><span className="label-text">Space key</span></label>
          <input type="text" className="input input-bordered w-full" placeholder="ENG" value={confSpaceKey} onChange={(e) => setConfSpaceKey(e.target.value)} />
        </div>

        <div className="form-control">
          <label className="label"><span className="label-text">Auth</span></label>
          <select className="select select-bordered w-full" value={confAuthType} onChange={(e) => setConfAuthType(e.target.value as 'token' | 'basic')}>
            <option value="token">Personal Access Token (Bearer)</option>
            <option value="basic">Username + Password (Basic)</option>
          </select>
        </div>

        <div className="form-control">
          <label className="label"><span className="label-text">Max pages</span></label>
          <input type="number" className="input input-bordered w-full" min={1} value={confLimit} onChange={(e) => setConfLimit(Number(e.target.value) || 50)} />
        </div>

        {confAuthType === 'token' ? (
          <div className="form-control md:col-span-2">
            <label className="label"><span className="label-text">Personal Access Token</span></label>
            <input type="password" className="input input-bordered w-full" placeholder={confTokenMask ? `Saved (${confTokenMask}) — leave empty to keep` : 'Enter PAT'} value={confToken} onChange={(e) => setConfToken(e.target.value)} />
          </div>
        ) : (
          <>
            <div className="form-control">
              <label className="label"><span className="label-text">Username</span></label>
              <input type="text" className="input input-bordered w-full" value={confUser} onChange={(e) => setConfUser(e.target.value)} />
            </div>
            <div className="form-control">
              <label className="label"><span className="label-text">Password</span></label>
              <input type="password" className="input input-bordered w-full" placeholder={confHasPassword ? 'Saved — leave empty to keep' : 'Enter password'} value={confPassword} onChange={(e) => setConfPassword(e.target.value)} />
            </div>
          </>
        )}

        <div className="form-control md:col-span-2">
          <label className="label cursor-pointer justify-start gap-3">
            <input type="checkbox" className="toggle toggle-sm" checked={confEnabled} onChange={(e) => setConfEnabled(e.target.checked)} />
            <span className="label-text">Enable Confluence dump</span>
          </label>
        </div>

        <div className="md:col-span-2 flex items-center gap-3">
          <button type="button" className="btn btn-primary btn-sm" onClick={handleConfSave} disabled={confSaving}>
            {confSaving ? <><span className="loading loading-spinner loading-xs"></span> Saving...</> : 'Save Confluence Config'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleConfTest}>Test connection</button>
          {confMessage && (<span className={`text-sm ${confMessage.type === 'success' ? 'text-success' : 'text-error'}`}>{confMessage.text}</span>)}
        </div>
      </div>
    </div>
  );
}
