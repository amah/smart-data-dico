import { useEffect, useState, useCallback } from 'react';
import Markdown from 'react-markdown';
import { ruleApi } from '../services/api';
import type { Rule, RuleScope, RuleSeverityValue, RuleEnforcement } from '../types';
import RuleEditor from '../components/RuleEditor';

/**
 * Rule browser page (#74).
 *
 * Lists all rules across the dictionary with filters by scope and severity.
 * Click a row to open the editor in side panel mode. Click "+ New Rule" to
 * create a new one.
 */
const RuleBrowserPage = () => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<RuleScope | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<RuleSeverityValue | 'all'>('all');
  const [enforcementFilter, setEnforcementFilter] = useState<RuleEnforcement | 'all'>('all');
  const [search, setSearch] = useState('');
  const [editorRule, setEditorRule] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ruleApi.list({
        scope: scopeFilter === 'all' ? undefined : scopeFilter,
        severity: severityFilter === 'all' ? undefined : severityFilter,
        enforcement: enforcementFilter === 'all' ? undefined : enforcementFilter,
      });
      setRules(data);
    } catch {
      setError('Failed to load rules. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, severityFilter, enforcementFilter]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const filteredRules = rules.filter(r => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      r.name.toLowerCase().includes(s) ||
      r.description.toLowerCase().includes(s) ||
      (r.tags || []).some(t => t.toLowerCase().includes(s))
    );
  });

  const severityBadgeClass = (severity: RuleSeverityValue) => {
    switch (severity) {
      case 'error': return 'badge-error';
      case 'warning': return 'badge-warning';
      case 'info': return 'badge-info';
      default: return 'badge-ghost';
    }
  };

  const scopeBadgeClass = (scope: RuleScope) => {
    switch (scope) {
      case 'entity': return 'badge-primary';
      case 'package': return 'badge-secondary';
      case 'perspective': return 'badge-accent';
      default: return 'badge-ghost';
    }
  };

  const enforcementBadgeClass = (enf: RuleEnforcement) => {
    switch (enf) {
      case 'save': return 'badge-error';
      case 'process': return 'badge-warning';
      case 'advisory': return 'badge-ghost';
      default: return 'badge-ghost';
    }
  };

  const handleSaved = () => {
    setEditorRule(null);
    setCreating(false);
    fetchRules();
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-semibold">Validation Rules</h1>
        <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
          + New Rule
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3 items-end">
        <input
          type="text"
          placeholder="Search by name, description, or tag..."
          className="input input-sm input-bordered flex-1 min-w-[200px]"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="select select-sm select-bordered"
          value={scopeFilter}
          onChange={e => setScopeFilter(e.target.value as RuleScope | 'all')}
        >
          <option value="all">All scopes</option>
          <option value="entity">Entity</option>
          <option value="package">Package</option>
          <option value="perspective">Perspective</option>
        </select>
        <select
          className="select select-sm select-bordered"
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value as RuleSeverityValue | 'all')}
        >
          <option value="all">All severities</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <select
          className="select select-sm select-bordered"
          value={enforcementFilter}
          onChange={e => setEnforcementFilter(e.target.value as RuleEnforcement | 'all')}
        >
          <option value="all">All enforcements</option>
          <option value="save">Save (blocking)</option>
          <option value="process">Process gate</option>
          <option value="advisory">Advisory</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-32">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      ) : error ? (
        <div className="alert alert-error">{error}</div>
      ) : (
        <div className="overflow-x-auto bg-base-100 rounded-lg shadow p-1 flex-1 min-h-0">
          <table className="table table-zebra table-sm w-full">
            <thead>
              <tr>
                <th>Name</th>
                <th>Severity</th>
                <th>Enforcement</th>
                <th>Scope</th>
                <th>Description</th>
                <th>Targets</th>
                <th>Tags</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-500 py-4">
                    {rules.length === 0
                      ? 'No rules yet. Click "+ New Rule" to add one.'
                      : 'No rules match the current filters.'}
                  </td>
                </tr>
              ) : (
                filteredRules.map(rule => (
                  <tr
                    key={rule.uuid}
                    className="hover cursor-pointer"
                    onClick={() => setEditorRule(rule)}
                  >
                    <td className="font-medium">
                      {rule.name}
                    </td>
                    <td>
                      <span className={`badge badge-xs ${severityBadgeClass(rule.severity)}`}>
                        {rule.severity}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-xs ${enforcementBadgeClass(rule.enforcement)}`}>
                        {rule.enforcement}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-xs ${scopeBadgeClass(rule.scope)}`}>
                        {rule.scope}
                      </span>
                    </td>
                    <td className="max-w-md">
                      <div className="prose prose-xs prose-invert max-w-none line-clamp-2 text-sm">
                        <Markdown>{rule.description.split('\n')[0] || ''}</Markdown>
                      </div>
                    </td>
                    <td className="text-xs">
                      {rule.targets.length} {rule.targets.length === 1 ? 'target' : 'targets'}
                    </td>
                    <td className="text-xs">
                      {(rule.tags || []).slice(0, 3).map(tag => (
                        <span key={tag} className="badge badge-xs badge-ghost mr-1">{tag}</span>
                      ))}
                    </td>
                    <td className="text-xs text-base-content/60">
                      {rule.updatedAt ? new Date(rule.updatedAt).toLocaleDateString() : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor modal */}
      {(editorRule || creating) && (
        <RuleEditor
          rule={editorRule}
          onClose={() => {
            setEditorRule(null);
            setCreating(false);
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
};

export default RuleBrowserPage;
