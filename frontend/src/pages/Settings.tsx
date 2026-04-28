import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { authApi, modelMetadataApi, stereotypeApi } from '../services/api';
import { User, MetadataEntry, Stereotype } from '../types';
import { useKeyboardShortcutsEnabled } from '../hooks/useKeyboardShortcuts';
import MetadataEditor from '../components/MetadataEditor';
import axios from 'axios';
import {
  AIToolCategory,
  AIPolicyDecision,
  loadPolicy,
  savePolicy,
  DEFAULT_AI_AUTO_APPROVE_POLICY,
} from '../utils/aiAutoApprovePolicy';

interface SettingsFormData {
  theme: string;
  notifications: boolean;
  emailNotifications: boolean;
  autoCommit: boolean;
  defaultView: string;
}

const PROVIDER_PRESETS: Record<string, { name: string; baseURL?: string; defaultModel: string }> = {
  'anthropic': { name: 'Anthropic', defaultModel: 'claude-sonnet-4-5-20250514' },
  'openai': { name: 'OpenAI', defaultModel: 'gpt-4o' },
  'openai-compatible': { name: 'OpenAI-Compatible', baseURL: '', defaultModel: 'gpt-4o' },
};

const KNOWN_ENDPOINTS = [
  { label: 'Mammouth AI', baseURL: 'https://api.mammouth.ai/v1', provider: 'openai-compatible' },
  { label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', provider: 'openai-compatible' },
  { label: 'Custom', baseURL: '', provider: 'openai-compatible' },
];

const Settings = () => {
  const { enabled: shortcutsEnabled, toggle: toggleShortcuts } = useKeyboardShortcutsEnabled();
  const [, setUser] = useState<User | null>(null);

  // Model-level metadata state (#94)
  const [modelMetadata, setModelMetadata] = useState<MetadataEntry[]>([]);
  const [modelStereotypeId, setModelStereotypeId] = useState<string>('');
  const [modelStereotypes, setModelStereotypes] = useState<Stereotype[]>([]);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelMessage, setModelMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    modelMetadataApi.get().then((doc) => {
      setModelMetadata(doc.metadata || []);
      setModelStereotypeId(doc.stereotype || '');
    }).catch(() => {});
    stereotypeApi.getAll('model').then(setModelStereotypes).catch(() => {});
  }, []);

  const handleModelSave = async () => {
    setModelSaving(true);
    setModelMessage(null);
    try {
      await modelMetadataApi.put({
        stereotype: modelStereotypeId || undefined,
        metadata: modelMetadata,
      });
      setModelMessage({ type: 'success', text: 'Model metadata saved' });
    } catch (err: any) {
      setModelMessage({ type: 'error', text: err.response?.data?.message || 'Failed to save' });
    } finally {
      setModelSaving(false);
    }
  };

  const selectedModelStereotype = modelStereotypes.find(s => s.id === modelStereotypeId) || null;

  // AI Config state
  const [aiProvider, setAiProvider] = useState('anthropic');
  const [aiModel, setAiModel] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiBaseURL, setAiBaseURL] = useState('');
  const [aiName, setAiName] = useState('');
  const [aiSaving, setAiSaving] = useState(false);
  const [aiMessage, setAiMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [aiConfigPath, setAiConfigPath] = useState('');

  // Load AI config
  useEffect(() => {
    axios.get('/api/ai/config').then(({ data }) => {
      setAiProvider(data.provider || 'anthropic');
      setAiModel(data.model || '');
      setAiApiKey(''); // Don't pre-fill masked key
      setAiBaseURL(data.baseURL || '');
      setAiName(data.name || '');
      setAiConfigPath(data.configPath || '');
    }).catch(() => {});
  }, []);

  // Per-category auto-approve policy (#59). Loaded from localStorage on
  // mount; saved synchronously on every radio change so the AIChatPanel
  // (in the same window or another tab via the storage event) picks it
  // up immediately.
  const [autoApprovePolicy, setAutoApprovePolicy] = useState(() => loadPolicy());

  const updatePolicyDecision = (category: AIToolCategory, decision: AIPolicyDecision) => {
    setAutoApprovePolicy(prev => {
      const next = { ...prev, [category]: decision };
      savePolicy(next);
      return next;
    });
  };

  const resetPolicyDefaults = () => {
    setAutoApprovePolicy(() => {
      const next = { ...DEFAULT_AI_AUTO_APPROVE_POLICY };
      savePolicy(next);
      return next;
    });
  };

  const handleAiSave = async () => {
    if (!aiApiKey && !aiApiKey.trim()) {
      setAiMessage({ type: 'error', text: 'API key is required' });
      return;
    }
    setAiSaving(true);
    setAiMessage(null);
    try {
      await axios.post('/api/ai/config', {
        provider: aiProvider,
        model: aiModel || PROVIDER_PRESETS[aiProvider]?.defaultModel,
        apiKey: aiApiKey,
        baseURL: aiProvider === 'openai-compatible' ? aiBaseURL : undefined,
        name: aiName || undefined,
      });
      setAiMessage({ type: 'success', text: 'AI configuration saved' });
      setAiApiKey(''); // Clear after save
    } catch (err: any) {
      setAiMessage({ type: 'error', text: err.response?.data?.message || 'Failed to save' });
    } finally {
      setAiSaving(false);
    }
  };
  const [loading, setLoading] = useState(true);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const { register, handleSubmit, reset } = useForm<SettingsFormData>({
    defaultValues: {
      theme: 'system',
      notifications: true,
      emailNotifications: true,
      autoCommit: false,
      defaultView: 'list'
    }
  });

  useEffect(() => {
    const fetchUserSettings = async () => {
      try {
        setLoading(true);
        const response = await authApi.getCurrentUser();
        setUser(response.data);
        
        // In a real application, you would fetch user settings from the API
        // For now, we'll just use default values
        reset({
          theme: 'system',
          notifications: true,
          emailNotifications: true,
          autoCommit: false,
          defaultView: 'list'
        });
      } catch (err) {
        console.error('Error fetching user settings:', err);
        setError('Failed to load user settings');
      } finally {
        setLoading(false);
      }
    };

    fetchUserSettings();
  }, [reset]);

  const onSubmit = async (data: SettingsFormData) => {
    try {
      setUpdateLoading(true);
      setError(null);
      setSuccess(null);
      
      // In a real application, you would call an API endpoint to update the user settings
      // For now, we'll just simulate a successful update
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setSuccess('Settings updated successfully');
      
      // Apply theme change
      if (data.theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else if (data.theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        // System theme
        document.documentElement.removeAttribute('data-theme');
      }
    } catch (err: any) {
      console.error('Settings update error:', err);
      setError(err.response?.data?.message || 'Failed to update settings');
    } finally {
      setUpdateLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Settings</h1>
      
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
      
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body">
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Appearance Settings */}
              <div className="md:col-span-2">
                <h2 className="text-xl font-bold mb-4">Appearance</h2>
              </div>
              
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Theme</span>
                </label>
                <select 
                  className="select select-bordered w-full"
                  {...register('theme')}
                >
                  <option value="system">System Default</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
              
              <div className="form-control">
                <label className="label">
                  <span className="label-text">Default View</span>
                </label>
                <select 
                  className="select select-bordered w-full"
                  {...register('defaultView')}
                >
                  <option value="list">List View</option>
                  <option value="grid">Grid View</option>
                  <option value="table">Table View</option>
                </select>
              </div>
              
              {/* Notification Settings */}
              <div className="md:col-span-2">
                <h2 className="text-xl font-bold mb-4 mt-4">Notifications</h2>
              </div>
              
              <div className="form-control">
                <label className="label cursor-pointer justify-start gap-4">
                  <input 
                    type="checkbox" 
                    className="toggle toggle-primary"
                    {...register('notifications')}
                  />
                  <div>
                    <span className="label-text font-medium">In-app Notifications</span>
                    <p className="text-xs opacity-70 mt-1">
                      Receive notifications within the application
                    </p>
                  </div>
                </label>
              </div>
              
              <div className="form-control">
                <label className="label cursor-pointer justify-start gap-4">
                  <input 
                    type="checkbox" 
                    className="toggle toggle-primary"
                    {...register('emailNotifications')}
                  />
                  <div>
                    <span className="label-text font-medium">Email Notifications</span>
                    <p className="text-xs opacity-70 mt-1">
                      Receive notifications via email
                    </p>
                  </div>
                </label>
              </div>
              
              {/* Data Dictionary Settings */}
              <div className="md:col-span-2">
                <h2 className="text-xl font-bold mb-4 mt-4">Data Dictionary</h2>
              </div>
              
              <div className="form-control">
                <label className="label cursor-pointer justify-start gap-4">
                  <input 
                    type="checkbox" 
                    className="toggle toggle-primary"
                    {...register('autoCommit')}
                  />
                  <div>
                    <span className="label-text font-medium">Auto-commit Changes</span>
                    <p className="text-xs opacity-70 mt-1">
                      Automatically commit changes when editing entities
                    </p>
                  </div>
                </label>
              </div>
              
              {/* Model Settings (#94) */}
              <div className="md:col-span-2">
                <h2 className="text-xl font-bold mb-4 mt-4">Model Settings</h2>
                <p className="text-sm opacity-70 mb-3">
                  Metadata for the data dictionary as a whole — e.g. data-classification, compliance framework, owner.
                </p>

                <div className="form-control max-w-md mb-4">
                  <label className="label"><span className="label-text">Model Stereotype</span></label>
                  <select
                    className="select select-bordered select-sm"
                    value={modelStereotypeId}
                    onChange={(e) => setModelStereotypeId(e.target.value)}
                  >
                    <option value="">— None —</option>
                    {modelStereotypes.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                <MetadataEditor
                  entries={modelMetadata}
                  stereotype={selectedModelStereotype}
                  onChange={setModelMetadata}
                />

                <div className="flex items-center gap-3 mt-4">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleModelSave}
                    disabled={modelSaving}
                  >
                    {modelSaving ? <><span className="loading loading-spinner loading-xs"></span> Saving...</> : 'Save Model Metadata'}
                  </button>
                  {modelMessage && (
                    <span className={`text-sm ${modelMessage.type === 'success' ? 'text-success' : 'text-error'}`}>
                      {modelMessage.text}
                    </span>
                  )}
                </div>
              </div>

              {/* AI Assistant */}
              <div className="md:col-span-2">
                <h2 className="text-xl font-bold mb-4 mt-4">AI Assistant</h2>
                {aiConfigPath && (
                  <p className="text-xs opacity-50 mb-3">Config file: <code>{aiConfigPath}</code></p>
                )}
              </div>

              <div className="form-control">
                <label className="label"><span className="label-text">Provider</span></label>
                <select
                  className="select select-bordered w-full"
                  value={aiProvider}
                  onChange={(e) => {
                    setAiProvider(e.target.value);
                    setAiModel(PROVIDER_PRESETS[e.target.value]?.defaultModel || '');
                    if (e.target.value !== 'openai-compatible') setAiBaseURL('');
                  }}
                >
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI</option>
                  <option value="openai-compatible">OpenAI-Compatible</option>
                </select>
              </div>

              <div className="form-control">
                <label className="label"><span className="label-text">Model</span></label>
                <input
                  type="text"
                  className="input input-bordered w-full"
                  placeholder={PROVIDER_PRESETS[aiProvider]?.defaultModel}
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                />
              </div>

              {aiProvider === 'openai-compatible' && (
                <>
                  <div className="form-control">
                    <label className="label"><span className="label-text">Endpoint</span></label>
                    <select
                      className="select select-bordered w-full"
                      value={KNOWN_ENDPOINTS.find(e => e.baseURL === aiBaseURL)?.label || 'Custom'}
                      onChange={(e) => {
                        const ep = KNOWN_ENDPOINTS.find(k => k.label === e.target.value);
                        if (ep) setAiBaseURL(ep.baseURL);
                      }}
                    >
                      {KNOWN_ENDPOINTS.map(ep => (
                        <option key={ep.label} value={ep.label}>{ep.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-control">
                    <label className="label"><span className="label-text">Base URL</span></label>
                    <input
                      type="text"
                      className="input input-bordered w-full"
                      placeholder="https://api.example.com/v1"
                      value={aiBaseURL}
                      onChange={(e) => setAiBaseURL(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="form-control md:col-span-2">
                <label className="label"><span className="label-text">API Key</span></label>
                <input
                  type="password"
                  className="input input-bordered w-full"
                  placeholder="Enter API key (leave empty to keep existing)"
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                />
              </div>

              <div className="md:col-span-2 flex items-center gap-3">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleAiSave}
                  disabled={aiSaving}
                >
                  {aiSaving ? <><span className="loading loading-spinner loading-xs"></span> Saving...</> : 'Save AI Config'}
                </button>
                {aiMessage && (
                  <span className={`text-sm ${aiMessage.type === 'success' ? 'text-success' : 'text-error'}`}>
                    {aiMessage.text}
                  </span>
                )}
              </div>

              {/* AI Auto-approve policy (#59) */}
              <div className="md:col-span-2" id="ai-auto-approve">
                <h3 className="text-lg font-bold mb-2 mt-4">Auto-approve policy</h3>
                <p className="text-sm opacity-70 mb-3">
                  Choose which tool categories run without confirmation. Reads and navigation are
                  safe to auto-approve; writes default to review so you see what the assistant
                  is about to change. Delete operations always require review.
                </p>
                <div className="overflow-x-auto" data-testid="ai-policy-table">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Tools</th>
                        <th className="text-center">Auto</th>
                        <th className="text-center">Review</th>
                        <th className="text-center">Off</th>
                      </tr>
                    </thead>
                    <tbody>
                      {([
                        { category: 'read' as AIToolCategory, label: 'Read', tools: 'listEntities, listStereotypes, getEntityDetails, listPackages', allowAuto: true },
                        { category: 'navigate' as AIToolCategory, label: 'Navigate', tools: 'navigateTo', allowAuto: true },
                        { category: 'create' as AIToolCategory, label: 'Create', tools: 'createEntity, createRelationship', allowAuto: true },
                        { category: 'modify' as AIToolCategory, label: 'Modify', tools: 'updateEntity, updateRelationship (future)', allowAuto: true },
                        { category: 'delete' as AIToolCategory, label: 'Delete', tools: 'deleteEntity (future)', allowAuto: false },
                      ]).map(row => {
                        const current = autoApprovePolicy[row.category];
                        return (
                          <tr key={row.category} data-testid={`ai-policy-row-${row.category}`}>
                            <td className="font-medium">{row.label}</td>
                            <td className="text-xs opacity-70">{row.tools}</td>
                            <td className="text-center">
                              {row.allowAuto ? (
                                <input
                                  type="radio"
                                  className="radio radio-sm radio-success"
                                  name={`policy-${row.category}`}
                                  data-testid={`ai-policy-${row.category}-auto`}
                                  checked={current === 'auto'}
                                  onChange={() => updatePolicyDecision(row.category, 'auto')}
                                />
                              ) : (
                                <span className="text-xs opacity-30" title="Delete operations may not be auto-approved">n/a</span>
                              )}
                            </td>
                            <td className="text-center">
                              <input
                                type="radio"
                                className="radio radio-sm radio-warning"
                                name={`policy-${row.category}`}
                                data-testid={`ai-policy-${row.category}-review`}
                                checked={
                                  // For the delete row, treat both 'review' and 'off' as
                                  // selecting Review at runtime; we pick the visible
                                  // bullet based on the stored value to preserve any
                                  // hand-written 'off' state.
                                  row.allowAuto ? current === 'review' : current === 'review'
                                }
                                onChange={() => updatePolicyDecision(row.category, 'review')}
                              />
                            </td>
                            <td className="text-center">
                              {row.allowAuto ? (
                                <span className="text-xs opacity-30" title="Use Review to disable auto-approve while still letting the assistant queue actions">—</span>
                              ) : (
                                <input
                                  type="radio"
                                  className="radio radio-sm"
                                  name={`policy-${row.category}`}
                                  data-testid={`ai-policy-${row.category}-off`}
                                  checked={current === 'off'}
                                  onChange={() => updatePolicyDecision(row.category, 'off')}
                                  title="Same effect as Review for delete; reserved for a future hard block"
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={resetPolicyDefaults}
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>

              {/* Keyboard Shortcuts */}
              <div className="md:col-span-2">
                <h2 className="text-xl font-bold mb-4 mt-4">Keyboard Shortcuts</h2>
              </div>

              <div className="form-control md:col-span-2">
                <label className="label cursor-pointer justify-start gap-4">
                  <input
                    type="checkbox"
                    className="toggle toggle-primary"
                    checked={shortcutsEnabled}
                    onChange={(e) => toggleShortcuts(e.target.checked)}
                  />
                  <div>
                    <span className="label-text font-medium">Enable Keyboard Shortcuts</span>
                    <p className="text-xs opacity-70 mt-1">
                      Use keyboard shortcuts for navigation and actions. Press <kbd className="kbd kbd-xs">?</kbd> to see all shortcuts.
                    </p>
                  </div>
                </label>
              </div>

              {/* Account Settings */}
              <div className="md:col-span-2">
                <h2 className="text-xl font-bold mb-4 mt-4">Account</h2>
                
                <div className="flex flex-col gap-2">
                  <button 
                    type="button" 
                    className="btn btn-outline btn-error w-full md:w-auto"
                    onClick={() => {
                      if (window.confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
                        // In a real application, you would call an API endpoint to delete the account
                        console.log('Delete account');
                      }
                    }}
                  >
                    Delete Account
                  </button>
                  
                  <p className="text-xs opacity-70">
                    This will permanently delete your account and all associated data.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="card-actions justify-end mt-8">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={updateLoading}
              >
                {updateLoading ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Saving...
                  </>
                ) : (
                  'Save Settings'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Settings;