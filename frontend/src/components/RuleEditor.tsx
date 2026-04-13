import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { ruleApi, entityApi, stereotypeApi } from '../services/api';
import type {
  Rule,
  RuleScope,
  RuleSeverityValue,
  RuleEnforcement,
  RuleTarget,
  RuleMetadataEntry,
  Package,
  Stereotype,
  StereotypeTarget,
} from '../types';

interface RuleEditorProps {
  /** Rule to edit, or null to create a new one */
  rule: Rule | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Metadata entry name used to bind a process-enforcement rule to a stage field. */
const STAGE_FIELD_KEY = 'process-stage-field';
/** Metadata entry name used to bind a process-enforcement rule to a target value. */
const STAGE_VALUE_KEY = 'process-stage-value';

/** Map a rule scope to the relevant stereotype `appliesTo` filters. */
const stereotypeTargetsForScope = (scope: RuleScope): StereotypeTarget[] => {
  switch (scope) {
    case 'entity':      return ['entity', 'attribute'];
    case 'package':     return ['package', 'entity', 'attribute'];
    case 'perspective': return ['entity', 'attribute', 'package'];
    case 'global':      return ['package', 'entity', 'attribute'];
    default:            return ['entity', 'attribute', 'package'];
  }
};

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
  const [enforcement, setEnforcement] = useState<RuleEnforcement>(rule?.enforcement || 'advisory');
  const [scope, setScope] = useState<RuleScope>(rule?.scope || 'package');
  const [tagsInput, setTagsInput] = useState((rule?.tags || []).join(', '));
  const [packageName, setPackageName] = useState(rule?.packageName || '');
  const [entityUuid, setEntityUuid] = useState(rule?.entityUuid || '');
  const [perspectiveUuid] = useState(rule?.perspectiveUuid || '');
  const [packages, setPackages] = useState<Package[]>([]);
  const [stereotypes, setStereotypes] = useState<Stereotype[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Process-stage binding (#76 C7) — extract from existing rule metadata
  const initialStageField =
    (rule?.metadata || []).find(m => m.name === STAGE_FIELD_KEY)?.value as string | undefined;
  const initialStageValue =
    (rule?.metadata || []).find(m => m.name === STAGE_VALUE_KEY)?.value as string | undefined;
  const [stageField, setStageField] = useState<string>(initialStageField || '');
  const [stageValue, setStageValue] = useState<string>(initialStageValue || '');

  // Load packages for the picker
  useEffect(() => {
    entityApi.getAllPackages().then(setPackages).catch(() => setPackages([]));
  }, []);

  // Load stereotypes (used by the process-stage field picker)
  useEffect(() => {
    stereotypeApi.getAll().then(setStereotypes).catch(() => setStereotypes([]));
  }, []);

  /**
   * Distinct metadata field names from stereotypes whose `appliesTo` is
   * relevant to the current rule scope. Used to populate the
   * process-stage-field dropdown when enforcement is 'process'.
   */
  const stageFieldOptions = useMemo(() => {
    const targets = new Set(stereotypeTargetsForScope(scope));
    const seen = new Map<string, { name: string; stereotypeName: string }>();
    for (const st of stereotypes) {
      if (!targets.has(st.appliesTo)) continue;
      for (const def of st.metadataDefinitions || []) {
        if (!seen.has(def.name)) {
          seen.set(def.name, { name: def.name, stereotypeName: st.name });
        }
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [stereotypes, scope]);

  // Default the package to the first one if creating
  useEffect(() => {
    if (isNew && !packageName && packages.length > 0) {
      setPackageName(packages[0].name);
    }
  }, [isNew, packageName, packages]);

  // Build target list — for v1: one target per rule, derived from scope.
  // For global rules: target carries packageName so cross-package resolution works.
  const buildTargets = (): RuleTarget[] => {
    if (scope === 'entity' && entityUuid) {
      return [{ kind: 'entity', uuid: entityUuid, packageName }];
    }
    if ((scope === 'package' || scope === 'global') && packageName) {
      const pkg = packages.find(p => p.name === packageName);
      if (pkg) return [{ kind: 'entity', uuid: pkg.id, packageName }];
    }
    if (scope === 'perspective' && perspectiveUuid) {
      return [{ kind: 'perspective-node', uuid: perspectiveUuid }];
    }
    return [];
  };

  const handleSave = async () => {
    setError(null);

    // Process-enforcement rules require a stage-field reference
    if (enforcement === 'process' && !stageField.trim()) {
      setError('Process-enforcement rules must reference a stereotype metadata field.');
      return;
    }

    setSaving(true);
    try {
      const targets = buildTargets();
      if (targets.length === 0) {
        setError('Please pick at least one target node for this rule.');
        setSaving(false);
        return;
      }

      // Build metadata: preserve any non-stage entries on the existing rule,
      // then layer the current stage-field/stage-value on top when applicable.
      const existingMetadata = (rule?.metadata || []).filter(
        m => m.name !== STAGE_FIELD_KEY && m.name !== STAGE_VALUE_KEY,
      );
      const metadata: RuleMetadataEntry[] = [...existingMetadata];
      if (enforcement === 'process') {
        metadata.push({ name: STAGE_FIELD_KEY, value: stageField.trim() });
        if (stageValue.trim()) {
          metadata.push({ name: STAGE_VALUE_KEY, value: stageValue.trim() });
        }
      }

      const payload: Partial<Rule> = {
        name: name.trim(),
        description: description.trim(),
        severity,
        enforcement,
        scope,
        targets,
        tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean),
        packageName: scope === 'package' || scope === 'entity' ? packageName : undefined,
        entityUuid: scope === 'entity' ? entityUuid : undefined,
        perspectiveUuid: scope === 'perspective' ? perspectiveUuid : undefined,
        metadata: metadata.length > 0 ? metadata : undefined,
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

        {/* Name + severity + enforcement + scope */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
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
            <label className="label py-1">
              <span className="label-text">Enforcement</span>
            </label>
            <select
              className="select select-sm select-bordered"
              value={enforcement}
              onChange={e => setEnforcement(e.target.value as RuleEnforcement)}
              title="When the rule is checked (decoupled from severity)"
            >
              <option value="advisory">Advisory (review only)</option>
              <option value="save">Save (blocks save on violation)</option>
              <option value="process">Process gate (transition)</option>
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
              <option value="global">Global (cross-package)</option>
            </select>
          </div>
        </div>

        {/* Global scope banner (#75) */}
        {scope === 'global' && (
          <div className="alert alert-warning py-2 text-sm mb-3">
            Global rules are stored in <code>data-dictionaries/rules.yaml</code> and reviewed by everyone.
            Use a package-local rule unless the rule truly crosses package boundaries.
          </div>
        )}

        {/* Target picker */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          {(scope === 'entity' || scope === 'package' || scope === 'global') && (
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

        {/* Process-stage picker (#76 C7) — only when enforcement is 'process' */}
        {enforcement === 'process' && (
          <div className="border border-warning/40 rounded-lg p-3 mb-3 bg-warning/5">
            <div className="text-xs text-base-content/70 mb-2">
              Process-enforcement rules fire when a node's metadata field changes.
              Pick the field to gate, and optionally a target value at which the
              rule must pass.
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="form-control">
                <label className="label py-1">
                  <span className="label-text">Process stage field</span>
                </label>
                {stageFieldOptions.length > 0 ? (
                  <select
                    className="select select-sm select-bordered"
                    value={stageField}
                    onChange={e => setStageField(e.target.value)}
                  >
                    <option value="">Select a metadata field…</option>
                    {stageFieldOptions.map(opt => (
                      <option key={opt.name} value={opt.name}>
                        {opt.name} (from {opt.stereotypeName})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="input input-sm input-bordered"
                    placeholder="e.g. lifecycle-stage"
                    value={stageField}
                    onChange={e => setStageField(e.target.value)}
                  />
                )}
                {stageFieldOptions.length === 0 && (
                  <span className="label-text-alt text-warning mt-1">
                    No stereotype metadata fields found for this scope. Free-text accepted.
                  </span>
                )}
              </div>
              <div className="form-control">
                <label className="label py-1">
                  <span className="label-text">Target value (optional)</span>
                </label>
                <input
                  type="text"
                  className="input input-sm input-bordered"
                  placeholder="e.g. approved"
                  value={stageValue}
                  onChange={e => setStageValue(e.target.value)}
                />
                <span className="label-text-alt text-base-content/50 mt-1">
                  If empty, the rule fires on any change to the field.
                </span>
              </div>
            </div>
          </div>
        )}

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
