/**
 * Element Styles manager (#element-style, slice 3).
 *
 * Two independent sections, each with its own draft/dirty/save cycle
 * (matching the DerivedTypesPage save grammar — edits stay local until
 * the user clicks the section's Save, which writes the whole list back):
 *
 *   - Named styles  → configApi.putElementStyles(styles)
 *   - Style rules   → configApi.putStyleRules(rules) (style select is
 *                     populated from the named-style names)
 *
 * Both PUT endpoints answer 400 { message, errors[] } on validation
 * failure; those errors are surfaced inline under the section header.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  configApi,
  type ElementStyle,
  type StyleRule,
} from '../services/api';
import {
  Button,
  Chip,
  Field,
  fieldStyle,
  fieldStyleMono,
  Icon,
} from '../components/ui';

const BORDER_STYLES: NonNullable<ElementStyle['borderStyle']>[] = ['solid', 'dashed', 'dotted'];
const MATCH_KINDS: StyleRule['match'][] = ['stereotype', 'role', 'entityName', 'physicalTableName'];

const ElementStylesPage = () => {
  const [styles, setStyles] = useState<ElementStyle[]>([]);
  const [rules, setRules] = useState<StyleRule[]>([]);
  const [loading, setLoading] = useState(true);

  const [stylesDirty, setStylesDirty] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);
  const [stylesSaving, setStylesSaving] = useState(false);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [stylesMessage, setStylesMessage] = useState<string | null>(null);
  const [rulesMessage, setRulesMessage] = useState<string | null>(null);
  const [stylesErrors, setStylesErrors] = useState<string[]>([]);
  const [rulesErrors, setRulesErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setStylesErrors([]);
    setRulesErrors([]);
    try {
      const [s, r] = await Promise.all([
        configApi.getElementStyles().catch((): ElementStyle[] => []),
        configApi.getStyleRules().catch((): StyleRule[] => []),
      ]);
      setStyles(s);
      setRules(r);
      setStylesDirty(false);
      setRulesDirty(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const styleNames = useMemo(
    () => styles.map(s => s.name).filter(Boolean),
    [styles],
  );

  // ──────────────── Named styles ────────────────

  const addStyle = () => {
    const next: ElementStyle = { name: `style-${styles.length + 1}` };
    setStyles([...styles, next]);
    setStylesDirty(true);
  };

  const updateStyle = (idx: number, patch: Partial<ElementStyle>) => {
    setStyles(prev => prev.map((s, i) => {
      if (i === idx) return { ...s, ...patch };
      // Single-default invariant: marking one style default clears the others.
      if (patch.default === true && s.default) return { ...s, default: false };
      return s;
    }));
    setStylesDirty(true);
  };

  const removeStyle = (idx: number) => {
    setStyles(prev => prev.filter((_, i) => i !== idx));
    setStylesDirty(true);
  };

  const saveStyles = async () => {
    setStylesSaving(true);
    setStylesErrors([]);
    setStylesMessage(null);
    try {
      const saved = await configApi.putElementStyles(styles);
      setStyles(saved);
      setStylesMessage('Saved.');
      setStylesDirty(false);
      setTimeout(() => setStylesMessage(null), 2500);
    } catch (e: any) {
      const resp = e?.response?.data;
      if (resp?.errors) setStylesErrors(resp.errors);
      else setStylesErrors([resp?.message || e?.message || 'Save failed']);
    } finally {
      setStylesSaving(false);
    }
  };

  // ──────────────── Style rules ────────────────

  const addRule = () => {
    const next: StyleRule = {
      match: 'stereotype',
      pattern: '',
      style: styleNames[0] || '',
    };
    setRules([...rules, next]);
    setRulesDirty(true);
  };

  const updateRule = (idx: number, patch: Partial<StyleRule>) => {
    setRules(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setRulesDirty(true);
  };

  const removeRule = (idx: number) => {
    setRules(prev => prev.filter((_, i) => i !== idx));
    setRulesDirty(true);
  };

  const saveRules = async () => {
    setRulesSaving(true);
    setRulesErrors([]);
    setRulesMessage(null);
    try {
      const saved = await configApi.putStyleRules(rules);
      setRules(saved);
      setRulesMessage('Saved.');
      setRulesDirty(false);
      setTimeout(() => setRulesMessage(null), 2500);
    } catch (e: any) {
      const resp = e?.response?.data;
      if (resp?.errors) setRulesErrors(resp.errors);
      else setRulesErrors([resp?.message || e?.message || 'Save failed']);
    } finally {
      setRulesSaving(false);
    }
  };

  // ──────────────── Render ────────────────

  return (
    <div className="flex flex-col gap-3" style={{ padding: 12, height: '100%', overflow: 'auto' }}>
      <div>
        <h1
          className="mono"
          style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600, margin: 0 }}
        >
          Element styles
        </h1>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
          Named visual styles for diagram elements plus the rules that map
          stereotypes, roles, entity names, or physical tables onto them.
        </p>
      </div>

      {/* ── Named styles ── */}
      <SectionCard
        title="Named styles"
        hint="Reusable visual definitions referenced by style rules and explicit overrides."
        dirty={stylesDirty}
        message={stylesMessage}
        saving={stylesSaving}
        onSave={saveStyles}
        onAdd={addStyle}
        addLabel="Add style"
        errors={stylesErrors}
      >
        {loading ? (
          <Muted>Loading…</Muted>
        ) : styles.length === 0 ? (
          <Muted>No named styles yet. Click “Add style” to create one.</Muted>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {styles.map((s, i) => (
              <StyleRow
                key={i}
                style={s}
                onChange={(patch) => updateStyle(i, patch)}
                onRemove={() => removeStyle(i)}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Style rules ── */}
      <SectionCard
        title="Style rules"
        hint="First matching rule wins. The style must be one of the named styles above."
        dirty={rulesDirty}
        message={rulesMessage}
        saving={rulesSaving}
        onSave={saveRules}
        onAdd={addRule}
        addLabel="Add rule"
        errors={rulesErrors}
      >
        {loading ? (
          <Muted>Loading…</Muted>
        ) : rules.length === 0 ? (
          <Muted>No style rules yet. Click “Add rule” to create one.</Muted>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rules.map((r, i) => (
              <RuleRow
                key={i}
                rule={r}
                styleNames={styleNames}
                onChange={(patch) => updateRule(i, patch)}
                onRemove={() => removeRule(i)}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

// ──────────────── Section card ────────────────

interface SectionCardProps {
  title: string;
  hint?: string;
  dirty: boolean;
  message: string | null;
  saving: boolean;
  onSave: () => void;
  onAdd: () => void;
  addLabel: string;
  errors: string[];
  children: ReactNode;
}

const SectionCard = ({
  title, hint, dirty, message, saving, onSave, onAdd, addLabel, errors, children,
}: SectionCardProps) => (
  <section
    style={{
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div
          className="uppercase"
          style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', letterSpacing: '0.06em', fontWeight: 600 }}
        >
          {title}
        </div>
        {hint && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>{hint}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {dirty && <Chip tone="warning" soft>unsaved</Chip>}
        {message && <Chip tone="success" soft>{message}</Chip>}
        <Button size="sm" variant="secondary" icon="plus" onClick={onAdd}>{addLabel}</Button>
        <Button size="sm" variant="primary" icon="check" onClick={onSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>

    {errors.length > 0 && (
      <div
        style={{
          padding: '10px 14px',
          background: 'var(--danger-soft)',
          color: 'var(--danger)',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--fs-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Icon name="warning" size={14} />
          <strong>Save blocked:</strong>
        </div>
        <ul style={{ marginLeft: 20, listStyle: 'disc' }}>
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      </div>
    )}

    {children}
  </section>
);

const Muted = ({ children }: { children: ReactNode }) => (
  <div style={{ padding: '10px 2px', fontSize: 'var(--fs-sm)', color: 'var(--text-subtle)' }}>
    {children}
  </div>
);

// ──────────────── Style row ────────────────

const StyleSwatch = ({ style }: { style: ElementStyle }) => (
  <span
    aria-hidden
    title="preview"
    style={{
      display: 'inline-block',
      width: 34,
      height: 22,
      borderRadius: 4,
      background: style.fill || 'transparent',
      border: `${style.borderWidth ?? 1}px ${style.borderStyle ?? 'solid'} ${style.border || 'var(--border-strong)'}`,
      opacity: style.opacity ?? 1,
      flex: '0 0 auto',
    }}
  />
);

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
/** Expand `#abc` → `#aabbcc`; the native color input requires 6-digit hex. */
function toHex(v: string | undefined): string {
  if (!v || !HEX_RE.test(v)) return '#888888'; // token/empty → neutral picker default
  return v.length === 4 ? '#' + v.slice(1).split('').map(c => c + c).join('') : v;
}

/** Standard preset swatches — a greyscale ramp then common hues — for quick
 *  selection. The text field still accepts theme tokens (primary/neutral/…). */
const COLOR_PRESETS = [
  '#111827', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#ffffff',
  '#dc2626', '#ea580c', '#d97706', '#059669', '#2563eb', '#7c3aed', '#db2777',
];

/** A color field that accepts a theme token OR hex (text). The swatch button opens
 *  a popover with standard preset swatches + a native custom picker. */
function ColorInput({ value, onChange, placeholder }: { value?: string; onChange: (v: string | undefined) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const isHex = !!value && HEX_RE.test(value);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
      <input
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder={placeholder}
        style={{ ...fieldStyleMono, flex: '1 1 auto', minWidth: 0 }}
      />
      <button
        type="button"
        aria-label="Presets & color picker"
        title="Presets & color picker"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 28, height: 28, padding: 0, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
          background: isHex ? value : 'var(--bg-raised)', border: '1px solid var(--border)',
          // token/empty → a diagonal hint so it's clear no explicit color is set
          backgroundImage: isHex ? undefined : 'linear-gradient(135deg, transparent 46%, var(--border-strong) 46%, var(--border-strong) 54%, transparent 54%)',
        }}
      />
      {open && (
        <div
          role="dialog"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 60,
            background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 8,
            padding: 8, boxShadow: 'var(--shadow-lg)', width: 172,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                aria-label={`Use ${c}`}
                onClick={() => { onChange(c); setOpen(false); }}
                style={{
                  width: 18, height: 18, padding: 0, borderRadius: 3, cursor: 'pointer', background: c,
                  border: value?.toLowerCase() === c ? '2px solid var(--accent)' : '1px solid var(--border)',
                  boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px var(--border)' : undefined,
                }}
              />
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--text-subtle)' }}>
            <input
              type="color"
              aria-label="Custom color"
              value={toHex(value)}
              onChange={(e) => onChange(e.target.value)}
              style={{ width: 26, height: 22, padding: 0, border: '1px solid var(--border)', borderRadius: 3, cursor: 'pointer', background: 'none' }}
            />
            Custom…
          </label>
        </div>
      )}
    </div>
  );
}

interface StyleRowProps {
  style: ElementStyle;
  onChange: (patch: Partial<ElementStyle>) => void;
  onRemove: () => void;
}

const StyleRow = ({ style, onChange, onRemove }: StyleRowProps) => {
  const numOrUndef = (raw: string): number | undefined => (raw === '' ? undefined : Number(raw));
  return (
    <div
      style={{
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-sm)',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        background: 'var(--bg-subtle)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StyleSwatch style={style} />
        {style.badge && <Chip tone="meta" soft>{style.badge}</Chip>}
        {style.emphasis && <Chip tone="accent" soft>emphasis</Chip>}
        {style.default && <Chip tone="neutral" soft>default</Chip>}
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" icon="close" iconOnly aria-label="remove style" onClick={onRemove} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Field label="Name (kebab, required)">
          <input
            type="text"
            value={style.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. reference-table"
            style={fieldStyleMono}
          />
        </Field>
        <Field label="Label">
          <input
            type="text"
            value={style.label ?? ''}
            onChange={(e) => onChange({ label: e.target.value || undefined })}
            style={fieldStyle}
          />
        </Field>
        <Field label="Fill">
          <ColorInput value={style.fill} onChange={(v) => onChange({ fill: v })} placeholder="#eef / var(--…)" />
        </Field>
        <Field label="Border">
          <ColorInput value={style.border} onChange={(v) => onChange({ border: v })} placeholder="#88a / var(--…)" />
        </Field>
        <Field label="Border width">
          <input
            type="number"
            value={style.borderWidth ?? ''}
            onChange={(e) => onChange({ borderWidth: numOrUndef(e.target.value) })}
            style={fieldStyleMono}
          />
        </Field>
        <Field label="Border style">
          <select
            value={style.borderStyle ?? 'solid'}
            onChange={(e) => onChange({ borderStyle: e.target.value as ElementStyle['borderStyle'] })}
            style={fieldStyleMono}
          >
            {BORDER_STYLES.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Shape">
          <input
            type="text"
            value={style.shape ?? ''}
            onChange={(e) => onChange({ shape: e.target.value || undefined })}
            placeholder="round-rectangle / ellipse …"
            style={fieldStyleMono}
          />
        </Field>
        <Field label="Opacity (0–1)">
          <input
            type="number"
            step="0.1"
            min="0"
            max="1"
            value={style.opacity ?? ''}
            onChange={(e) => onChange({ opacity: numOrUndef(e.target.value) })}
            style={fieldStyleMono}
          />
        </Field>
        <Field label="Text color">
          <ColorInput value={style.textColor} onChange={(v) => onChange({ textColor: v })} placeholder="#222 / var(--…)" />
        </Field>
        <Field label="Badge">
          <input
            type="text"
            value={style.badge ?? ''}
            onChange={(e) => onChange({ badge: e.target.value || undefined })}
            placeholder="short text"
            style={fieldStyle}
          />
        </Field>
        <Field label="Emphasis" inline>
          <input
            type="checkbox"
            checked={!!style.emphasis}
            onChange={(e) => onChange({ emphasis: e.target.checked || undefined })}
          />
        </Field>
        <Field label="Default (fallback)" inline>
          <input
            type="checkbox"
            checked={!!style.default}
            onChange={(e) => onChange({ default: e.target.checked || undefined })}
            title="Applied to any element that no rule, role, or stereotype styles"
          />
        </Field>
      </div>
    </div>
  );
};

// ──────────────── Rule row ────────────────

interface RuleRowProps {
  rule: StyleRule;
  styleNames: string[];
  onChange: (patch: Partial<StyleRule>) => void;
  onRemove: () => void;
}

const RuleRow = ({ rule, styleNames, onChange, onRemove }: RuleRowProps) => (
  <div
    style={{
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-sm)',
      padding: 10,
      display: 'grid',
      gridTemplateColumns: '160px 1fr 90px 180px 32px',
      gap: 10,
      alignItems: 'end',
      background: 'var(--bg-subtle)',
    }}
  >
    <Field label="Match">
      <select
        value={rule.match}
        onChange={(e) => onChange({ match: e.target.value as StyleRule['match'] })}
        style={fieldStyleMono}
      >
        {MATCH_KINDS.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
    </Field>
    <Field label="Pattern">
      <input
        type="text"
        value={rule.pattern}
        onChange={(e) => onChange({ pattern: e.target.value })}
        placeholder={rule.regex ? '^ref_.*$' : 'ref_* (glob)'}
        style={fieldStyleMono}
      />
    </Field>
    <Field label="Regex" inline>
      <input
        type="checkbox"
        checked={!!rule.regex}
        onChange={(e) => onChange({ regex: e.target.checked || undefined })}
      />
    </Field>
    <Field label="Style">
      <select
        value={rule.style}
        onChange={(e) => onChange({ style: e.target.value })}
        style={fieldStyleMono}
      >
        {styleNames.length === 0 && <option value="">— no styles defined —</option>}
        {!styleNames.includes(rule.style) && rule.style && (
          <option value={rule.style}>{rule.style} (unknown)</option>
        )}
        {styleNames.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
    </Field>
    <Button size="sm" variant="ghost" icon="close" iconOnly aria-label="remove rule" onClick={onRemove} />
  </div>
);

export default ElementStylesPage;
