import { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import { entityApi, stereotypeApi } from '../../../../services/api';
import { useService } from '../../../../kernel/useService';
import { RULE_SERVICE_TOKEN } from '../../../../kernel/tokens';
import type { RuleService } from '../../services/RuleService';
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
} from '../../../../types';
import { Button, Field, fieldStyle, Modal } from '../../../../components/ui';

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
    case 'case':        return ['entity', 'attribute', 'package'];
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
  const ruleService = useService<RuleService>(RULE_SERVICE_TOKEN);
  const isNew = rule === null;
  const [name, setName] = useState(rule?.name || '');
  const [description, setDescription] = useState(rule?.description || '');
  const [severity, setSeverity] = useState<RuleSeverityValue>(rule?.severity || 'warning');
  const [enforcement, setEnforcement] = useState<RuleEnforcement>(rule?.enforcement || 'advisory');
  const [scope, setScope] = useState<RuleScope>(rule?.scope || 'package');
  const [tagsInput, setTagsInput] = useState((rule?.tags || []).join(', '));
  const [packageName, setPackageName] = useState(rule?.packageName || '');
  const [entityUuid, setEntityUuid] = useState(rule?.entityUuid || '');
  const [caseUuid] = useState(rule?.caseUuid || '');
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
    if (scope === 'case' && caseUuid) {
      return [{ kind: 'case-node', uuid: caseUuid }];
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
        caseUuid: scope === 'case' ? caseUuid : undefined,
        metadata: metadata.length > 0 ? metadata : undefined,
      };
      if (isNew) {
        await ruleService.create(payload);
      } else {
        await ruleService.update(rule!.uuid, payload);
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
      await ruleService.delete(rule.uuid);
      onSaved();
    } catch {
      setError('Failed to delete rule.');
      setSaving(false);
    }
  };

  // Available entities in the currently selected package
  const currentPackage = packages.find(p => p.name === packageName);
  const entitiesInPackage = currentPackage?.entities || [];

  const textareaStyle = {
    ...fieldStyle,
    height: 'auto',
    minHeight: 120,
    padding: '8px 10px',
    fontFamily: 'var(--font-mono)',
    resize: 'vertical' as const,
  };

  return (
    <Modal
      open
      title={isNew ? 'New Rule' : `Edit Rule: ${rule?.name}`}
      onClose={onClose}
      width={900}
    >
      {error && <ErrorPane>{error}</ErrorPane>}

      {/* Name + severity + enforcement + scope */}
      <FieldGrid columns={4}>
        <Field label="Name (kebab-case)">
          <input
            type="text"
            placeholder="e.g. email-format"
            value={name}
            onChange={e => setName(e.target.value)}
            style={fieldStyle}
          />
        </Field>
        <Field label="Severity">
          <select
            value={severity}
            onChange={e => setSeverity(e.target.value as RuleSeverityValue)}
            style={fieldStyle}
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </Field>
        <Field label="Enforcement">
          <select
            value={enforcement}
            onChange={e => setEnforcement(e.target.value as RuleEnforcement)}
            title="When the rule is checked (decoupled from severity)"
            style={fieldStyle}
          >
            <option value="advisory">Advisory (review only)</option>
            <option value="save">Save (blocks save on violation)</option>
            <option value="process">Process gate (transition)</option>
          </select>
        </Field>
        <Field label="Scope">
          <select
            value={scope}
            onChange={e => setScope(e.target.value as RuleScope)}
            style={fieldStyle}
          >
            <option value="entity">Entity (within a single entity)</option>
            <option value="package">Package (within a package)</option>
            <option value="case">Case</option>
            <option value="global">Global (cross-package)</option>
          </select>
        </Field>
      </FieldGrid>

      {/* Global scope banner (#75) */}
      {scope === 'global' && (
        <WarningPane>
          Global rules are stored at the project root as <code>rules.yaml</code> and reviewed by everyone.
          Use a package-local rule unless the rule truly crosses package boundaries.
        </WarningPane>
      )}

      {/* Target picker */}
      <FieldGrid columns={2}>
        {(scope === 'entity' || scope === 'package' || scope === 'global') && (
          <Field label="Package">
            <select
              value={packageName}
              onChange={e => {
                setPackageName(e.target.value);
                setEntityUuid('');
              }}
              style={fieldStyle}
            >
              <option value="">Select a package…</option>
              {packages.map(p => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </Field>
        )}
        {scope === 'entity' && (
          <Field label="Entity">
            <select
              value={entityUuid}
              onChange={e => setEntityUuid(e.target.value)}
              disabled={!packageName}
              style={fieldStyle}
            >
              <option value="">Select an entity…</option>
              {entitiesInPackage.map(e => (
                <option key={e.uuid} value={e.uuid}>{e.name}</option>
              ))}
            </select>
          </Field>
        )}
      </FieldGrid>

      {/* Process-stage picker (#76 C7) — only when enforcement is 'process' */}
      {enforcement === 'process' && (
        <div
          style={{
            border: '1px solid var(--warning)',
            borderRadius: 'var(--radius-md)',
            padding: 12,
            background: 'var(--warning-soft)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            Process-enforcement rules fire when a node's metadata field changes.
            Pick the field to gate, and optionally a target value at which the
            rule must pass.
          </div>
          <FieldGrid columns={2}>
            <Field label="Process stage field">
              {stageFieldOptions.length > 0 ? (
                <select
                  value={stageField}
                  onChange={e => setStageField(e.target.value)}
                  style={fieldStyle}
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
                  placeholder="e.g. lifecycle-stage"
                  value={stageField}
                  onChange={e => setStageField(e.target.value)}
                  style={fieldStyle}
                />
              )}
              {stageFieldOptions.length === 0 && (
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)', marginTop: 4 }}>
                  No stereotype metadata fields found for this scope. Free-text accepted.
                </span>
              )}
            </Field>
            <Field label="Target value (optional)">
              <input
                type="text"
                placeholder="e.g. approved"
                value={stageValue}
                onChange={e => setStageValue(e.target.value)}
                style={fieldStyle}
              />
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', marginTop: 4 }}>
                If empty, the rule fires on any change to the field.
              </span>
            </Field>
          </FieldGrid>
        </div>
      )}

      {/* Description / markdown editor */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
            Description (markdown)
          </span>
          <Button size="sm" variant="ghost" onClick={() => setShowPreview(!showPreview)}>
            {showPreview ? 'Edit' : 'Preview'}
          </Button>
        </div>
        {showPreview ? (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: 12,
              minHeight: 120,
              fontSize: 'var(--fs-sm)',
              color: 'var(--text)',
            }}
          >
            <Markdown>{description || '*(empty)*'}</Markdown>
          </div>
        ) : (
          <textarea
            rows={6}
            placeholder="Describe the rule in markdown. e.g.&#10;&#10;## Email format&#10;Must match RFC 5322. Violations indicate a data-import bug."
            value={description}
            onChange={e => setDescription(e.target.value)}
            style={textareaStyle}
          />
        )}
      </div>

      {/* Tags */}
      <Field label="Tags (comma-separated)">
        <input
          type="text"
          placeholder="e.g. data-quality, pii, referential-integrity"
          value={tagsInput}
          onChange={e => setTagsInput(e.target.value)}
          style={fieldStyle}
        />
      </Field>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 8,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
        }}
      >
        <div>
          {!isNew && (
            <Button size="sm" variant="danger" icon="close" onClick={handleDelete} disabled={saving}>
              Delete
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="md" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="md" variant="primary" icon="check" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// ──────────────── Helpers ────────────────

const FieldGrid = ({ columns, children }: { columns: 2 | 4; children: React.ReactNode }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      gap: 12,
    }}
  >
    {children}
  </div>
);

const ErrorPane = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      padding: '8px 12px',
      fontSize: 'var(--fs-sm)',
      background: 'var(--danger-soft)',
      color: 'var(--danger)',
      border: '1px solid var(--danger)',
      borderRadius: 'var(--radius-sm)',
    }}
  >
    {children}
  </div>
);

const WarningPane = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      padding: '8px 12px',
      fontSize: 'var(--fs-sm)',
      background: 'var(--warning-soft)',
      color: 'var(--text)',
      border: '1px solid var(--warning)',
      borderRadius: 'var(--radius-sm)',
    }}
  >
    {children}
  </div>
);

export default RuleEditor;
