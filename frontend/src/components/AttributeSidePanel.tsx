import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Attribute, AttributeType } from '../types';
import { getMetadataValue, type MetadataColumn } from '../hooks/useStereotypeMetadata';
import { Button, Field, MetadataField, fieldStyle, fieldStyleMono } from './ui';

/**
 * AttributeSidePanel — the shared slide-over editor for a single
 * attribute, used by AttributeList (entity scope) and AttributeFlatTable
 * (global scope).
 *
 * Everything beyond the core fields (name/type/description/required/default)
 * is optional so the flat view can render a minimal panel while the
 * per-entity view offers full-editor navigation, governance metadata
 * editing, and the rules launcher.
 */

interface AttributeSidePanelProps {
  attr: Attribute;
  onClose: () => void;
  onSave: (patch: Partial<Attribute>) => Promise<void>;

  /** Governance metadata section — renders only when both are provided. */
  metaColumns?: MetadataColumn[];
  onMetadataChange?: (col: MetadataColumn, value: string | number | boolean) => void;

  /** "Full editor" link — renders only when both path segments are provided. */
  entityName?: string;
  serviceName?: string;

  /** Rules launcher — renders only when provided. */
  onOpenRules?: () => void;

  /** Optional breadcrumb shown next to the attribute name (e.g. "user-service · User"). */
  contextLabel?: string;
}

const AttributeSidePanel = ({
  attr,
  onClose,
  onSave,
  metaColumns,
  onMetadataChange,
  entityName,
  serviceName,
  onOpenRules,
  contextLabel,
}: AttributeSidePanelProps) => {
  const [name, setName] = useState(attr.name);
  const [type, setType] = useState<AttributeType>(attr.type);
  const [description, setDescription] = useState(attr.description ?? '');
  const [required, setRequired] = useState(!!attr.required);
  const [defaultValue, setDefaultValue] = useState<string>(
    attr.defaultValue === undefined || attr.defaultValue === null ? '' : String(attr.defaultValue),
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Re-hydrate when switching rows.
  useEffect(() => {
    setName(attr.name);
    setType(attr.type);
    setDescription(attr.description ?? '');
    setRequired(!!attr.required);
    setDefaultValue(
      attr.defaultValue === undefined || attr.defaultValue === null ? '' : String(attr.defaultValue),
    );
    setSavedAt(null);
  }, [attr.uuid]);

  const dirty =
    name !== attr.name ||
    type !== attr.type ||
    description !== (attr.description ?? '') ||
    required !== !!attr.required ||
    defaultValue !== (attr.defaultValue === undefined || attr.defaultValue === null ? '' : String(attr.defaultValue));

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave({
        name,
        type,
        description,
        required,
        defaultValue: defaultValue === '' ? undefined : defaultValue,
      });
      setSavedAt(Date.now());
    } catch (err) {
      console.error('Failed to save attribute:', err);
    } finally {
      setSaving(false);
    }
  };

  const showFullEditor = !!serviceName && !!entityName;
  const showMetadata = !!metaColumns && metaColumns.length > 0 && !!onMetadataChange;

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.25)',
          zIndex: 40,
        }}
      />
      <aside
        role="dialog"
        aria-label="Edit attribute"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          background: 'var(--bg-raised)',
          borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 50,
          animation: 'sddSlide var(--dur-med) ease-out',
        }}
      >
        <style>{`
          @keyframes sddSlide {
            from { transform: translateX(100%); opacity: 0.7; }
            to   { transform: translateX(0);     opacity: 1;   }
          }
        `}</style>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 14px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span
            className="uppercase mono"
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', letterSpacing: '0.04em' }}
          >
            edit attribute
          </span>
          <span
            className="mono"
            style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)' }}
          >
            {attr.name}
          </span>
          {contextLabel && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
              {contextLabel}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {showFullEditor && (
            <Link to={`/packages/${serviceName}/entities/${entityName}/attributes/${attr.name}/edit`}>
              <Button size="sm" variant="ghost" icon="edit">Full editor</Button>
            </Link>
          )}
          <Button size="sm" variant="ghost" icon="close" onClick={onClose} iconOnly aria-label="close" />
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <Field label="Name">
            <input
              type="text"
              value={name}
              aria-label="Name"
              onChange={(e) => setName(e.target.value)}
              style={fieldStyleMono}
            />
          </Field>
          <Field label="Type">
            <select
              value={type}
              aria-label="Type"
              onChange={(e) => setType(e.target.value as AttributeType)}
              style={fieldStyleMono}
            >
              {Object.values(AttributeType).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              aria-label="Description"
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ ...fieldStyle, minHeight: 60, padding: '6px 8px', fontFamily: 'inherit' }}
            />
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <Field label="Required" inline>
              <input
                type="checkbox"
                aria-label="Required"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
            </Field>
            <Field label="Default value" grow>
              <input
                type="text"
                value={defaultValue}
                aria-label="Default value"
                onChange={(e) => setDefaultValue(e.target.value)}
                style={fieldStyleMono}
              />
            </Field>
          </div>

          {showMetadata && (
            <div>
              <div
                className="uppercase"
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--meta-label)',
                  letterSpacing: '0.06em',
                  fontWeight: 600,
                  marginTop: 8,
                  marginBottom: 6,
                  paddingBottom: 4,
                  borderBottom: '1px dashed var(--meta-border)',
                }}
              >
                Governance metadata
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {metaColumns!.map((col) => (
                  <MetadataField
                    key={col.name}
                    column={col}
                    value={getMetadataValue(attr, col.name)}
                    onChange={(v) => onMetadataChange!(col, v)}
                  />
                ))}
              </div>
            </div>
          )}

          {onOpenRules && (
            <div style={{ paddingTop: 4 }}>
              <Button size="sm" variant="ghost" icon="shield" onClick={onOpenRules}>
                Manage rules / constraints
              </Button>
            </div>
          )}
        </div>

        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Button
            size="md"
            variant="primary"
            icon="check"
            onClick={handleSave}
            disabled={!dirty || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button size="md" variant="ghost" onClick={onClose}>Cancel</Button>
          {savedAt && !dirty && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--success)' }}>Saved</span>
          )}
        </div>
      </aside>
    </>
  );
};

export default AttributeSidePanel;
export type { AttributeSidePanelProps };
