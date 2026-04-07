import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { ruleApi, entityApi } from '../services/api';
import type { Rule, RuleScope, RuleSeverityValue, RuleTarget, Package } from '../types';

interface RuleEditorProps {
  /** Rule to edit, or null to create a new one */
  rule: Rule | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Modal for creating or editing a validation rule (#74).
 *
 * Side-by-side markdown editor with live preview. Target picker is
 * single-entity for v1 — multi-target and complex pickers come later.
 */
const RuleEditor = ({ rule, onClose, onSaved }: RuleEditorProps) => {
  const isNew = rule === null;
  const [name, setName] = useState(rule?.name || '');
  const [description, setDescription] = useState(rule?.description || '');
  const [severity, setSeverity] = useState<RuleSeverityValue>(rule?.severity || 'warning');
  const [scope, setScope] = useState<RuleScope>(rule?.scope || 'package');
  const [tagsInput, setTagsInput] = useState((rule?.tags || []).join(', '));
  const [packageName, setPackageName] = useState(rule?.packageName || '');
  const [entityUuid, setEntityUuid] = useState(rule?.entityUuid || '');
  const [perspectiveUuid] = useState(rule?.perspectiveUuid || '');
  const [packages, setPackages] = useState<Package[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Load packages for the picker
  useEffect(() => {
    entityApi.getAllPackages().then(setPackages).catch(() => setPackages([]));
  }, []);

  // Default the package to the first one if creating
  useEffect(() => {
    if (isNew && !packageName && packages.length > 0) {
      setPackageName(packages[0].name);
    }
  }, [isNew, packageName, packages]);

  // Build target list — for v1: one target per rule, derived from scope
  const buildTargets = (): RuleTarget[] => {
    if (scope === 'entity' && entityUuid) {
      return [{ kind: 'entity', uuid: entityUuid }];
    }
    if (scope === 'package' && packageName) {
      const pkg = packages.find(p => p.name === packageName);
      if (pkg) return [{ kind: 'entity', uuid: pkg.id }];
    }
    if (scope === 'perspective' && perspectiveUuid) {
      return [{ kind: 'perspective-node', uuid: perspectiveUuid }];
    }
    return [];
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const targets = buildTargets();
      if (targets.length === 0) {
        setError('Please pick at least one target node for this rule.');
        setSaving(false);
        return;
      }
      const payload: Partial<Rule> = {
        name: name.trim(),
        description: description.trim(),
        severity,
        scope,
        targets,
        tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
        packageName: scope === 'package' || scope === 'entity' ? packageName : undefined,
        entityUuid: scope === 'entity' ? entityUuid : undefined,
        perspectiveUuid: scope === 'perspective' ? perspectiveUuid : undefined,
      };
      if (isNew) {
        await ruleApi.create(payload);
      } else {
        await ruleApi.update(rule!.uuid, payload);
      }
      onSaved();
    } catch (err: any) {
      const msg = err?.response?.data?.errors?.join(', ') || err?.response?.data?.message || 'Failed to save rule.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!rule) return;
    if (!window.confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await ruleApi.delete(rule.uuid);
      onSaved();
    } catch {
      setError('Failed to delete rule.');
      setSaving(false);
    }
  };

  // Available entities in the currently selected package
  const currentPackage = packages.find(p => p.name === packageName);
  const entitiesInPackage = currentPackage?.entities || [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-base-100 p-6 rounded-lg shadow-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">{isNew ? 'New Rule' : `Edit Rule: ${rule?.name}`}</h2>
          <button className="btn btn-sm btn-ghost btn-circle" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && <div className="alert alert-error mb-4">{error}</div>}

        {/* Name + severity + scope */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div className="form-control">
            <label className="label py-1"><span className="label-text">Name (kebab-case)</span></label>
            <input
              type="text"
              className="input input-sm input-bordered"
              placeholder="e.g. email-format"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="form-control">
            <label className="label py-1"><span className="label-text">Severity</span></label>
            <select
              className="select select-sm select-bordered"
              value={severity}
              onChange={e => setSeverity(e.target.value as RuleSeverityValue)}
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div className="form-control">
            <label className="label py-1"><span className="label-text">Scope</span></label>
            <select
              className="select select-sm select-bordered"
              value={scope}
              onChange={e => setScope(e.target.value as RuleScope)}
            >
              <option value="entity">Entity (within a single entity)</option>
              <option value="package">Package (within a package)</option>
              <option value="perspective">Perspective</option>
            </select>
          </div>
        </div>

        {/* Target picker */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          {(scope === 'entity' || scope === 'package') && (
            <div className="form-control">
              <label className="label py-1"><span className="label-text">Package</span></label>
              <select
                className="select select-sm select-bordered"
                value={packageName}
                onChange={e => {
                  setPackageName(e.target.value);
                  setEntityUuid('');
                }}
              >
                <option value="">Select a package…</option>
                {packages.map(p => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
          {scope === 'entity' && (
            <div className="form-control">
              <label className="label py-1"><span className="label-text">Entity</span></label>
              <select
                className="select select-sm select-bordered"
                value={entityUuid}
                onChange={e => setEntityUuid(e.target.value)}
                disabled={!packageName}
              >
                <option value="">Select an entity…</option>
                {entitiesInPackage.map(e => (
                  <option key={e.uuid} value={e.uuid}>{e.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Description / markdown editor */}
        <div className="form-control mb-3">
          <div className="flex items-center justify-between">
            <label className="label py-1"><span className="label-text">Description (markdown)</span></label>
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? 'Edit' : 'Preview'}
            </button>
          </div>
          {showPreview ? (
            <div className="border border-base-300 rounded-lg p-3 min-h-[120px] prose prose-sm prose-invert max-w-none">
              <Markdown>{description || '*(empty)*'}</Markdown>
            </div>
          ) : (
            <textarea
              className="textarea textarea-bordered font-mono text-sm"
              rows={6}
              placeholder="Describe the rule in markdown. e.g.&#10;&#10;## Email format&#10;Must match RFC 5322. Violations indicate a data-import bug."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          )}
        </div>

        {/* Tags */}
        <div className="form-control mb-3">
          <label className="label py-1"><span className="label-text">Tags (comma-separated)</span></label>
          <input
            type="text"
            className="input input-sm input-bordered"
            placeholder="e.g. data-quality, pii, referential-integrity"
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center mt-6">
          <div>
            {!isNew && (
              <button className="btn btn-sm btn-error btn-outline" onClick={handleDelete} disabled={saving}>
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-sm btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <span className="loading loading-spinner loading-xs"></span> : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RuleEditor;
