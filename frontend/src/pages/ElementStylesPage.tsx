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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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

/**
 * Factory defaults — the starter palette from docs/element-style.md, plus a
 * neutral-grey `base` marked `default` so unstyled elements look uniform. Used by
 * the header "Reset to defaults" action. Kept in sync with the doc by
 * elementStyleDefaults.test.ts (invariants: kebab names, one default, rules ref known styles).
 */
export const FACTORY_STYLES: ElementStyle[] = [
  { name: 'base', label: 'Base (default)', fill: 'neutral-subtle', border: 'neutral', default: true },
  { name: 'aggregate-root', label: 'Aggregate Root', fill: 'primary-subtle', border: 'primary', borderWidth: 4, shape: 'round-rectangle', badge: 'AR', emphasis: true },
  { name: 'junction', label: 'Relation table', fill: 'neutral-subtle', shape: 'hexagon', opacity: 0.7 },
  { name: 'reference', label: 'Reference / lookup', border: 'neutral', borderStyle: 'dashed' },
  { name: 'remote-ref', label: 'Remote reference', fill: 'warning-subtle', border: 'warning', borderStyle: 'dotted' },
];
export const FACTORY_RULES: StyleRule[] = [
  { match: 'stereotype', pattern: 'aggregate-root', style: 'aggregate-root' },
  { match: 'physicalTableName', pattern: '*_link', style: 'junction' },
];

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

  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

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

  // ──────────────── Reset to factory defaults ────────────────

  // Replaces BOTH lists with the starter palette and persists them. Styles are
  // saved before rules so the rules' style references validate against them.
  const resetToDefaults = async () => {
    setResetting(true);
    setStylesErrors([]);
    setRulesErrors([]);
    setStylesMessage(null);
    setRulesMessage(null);
    try {
      const savedStyles = await configApi.putElementStyles(FACTORY_STYLES);
      const savedRules = await configApi.putStyleRules(FACTORY_RULES);
      setStyles(savedStyles);
      setRules(savedRules);
      setStylesDirty(false);
      setRulesDirty(false);
      setStylesMessage('Reset to defaults.');
      setTimeout(() => setStylesMessage(null), 2500);
      setConfirmingReset(false);
    } catch (e: any) {
      const resp = e?.response?.data;
      setStylesErrors(resp?.errors ?? [resp?.message || e?.message || 'Reset failed']);
    } finally {
      setResetting(false);
    }
  };

  // ──────────────── Render ────────────────

  return (
    <div className="flex flex-col gap-3" style={{ padding: 12, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
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
        {/* Reset to factory defaults — inline two-step confirm (destructive: replaces
            every style + rule with the starter palette). */}
        {confirmingReset ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>Replace all styles &amp; rules?</span>
            <Button size="sm" variant="secondary" onClick={() => setConfirmingReset(false)} disabled={resetting}>Cancel</Button>
            <Button size="sm" variant="danger" onClick={resetToDefaults} disabled={resetting}>
              {resetting ? 'Resetting…' : 'Reset to defaults'}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmingReset(true)} disabled={loading}>
            Reset to defaults
          </Button>
        )}
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

// Theme-token → DaisyUI CSS var, so previews/swatches show the *actual* color a
// token resolves to (matching the diagram) instead of an invalid CSS value.
const STYLE_TOKEN_VAR: Record<string, string> = {
  primary: '--p', 'primary-content': '--pc', neutral: '--n', accent: '--accent',
  base: '--b1', 'base-content': '--bc', warning: '--wa', error: '--er', success: '--su', info: '--in',
};
// Token→color cache. `getComputedStyle` is expensive and was previously called
// per color field on every render; resolve all tokens ONCE per theme instead.
let _tokenCache: { theme: string; map: Record<string, string> } | null = null;
function tokenColor(token: string): string | undefined {
  const theme = document.documentElement.getAttribute('data-theme') ?? '';
  if (!_tokenCache || _tokenCache.theme !== theme) {
    const cs = getComputedStyle(document.documentElement);
    const map: Record<string, string> = {};
    for (const [name, cssVar] of Object.entries(STYLE_TOKEN_VAR)) {
      const raw = cs.getPropertyValue(cssVar).trim();
      map[name] = !raw ? '' : /^(#|rgb|hsl|oklch)/.test(raw) ? raw : raw.includes('%') ? `hsl(${raw})` : `oklch(${raw})`;
    }
    _tokenCache = { theme, map };
  }
  return _tokenCache.map[token] || undefined;
}

/** Resolve a token/hex color value to a displayable CSS color (+ whether it's a
 *  `*-subtle` variant). Returns undefined color when nothing can be resolved. */
function resolveDisplayColor(value?: string): { color?: string; subtle: boolean } {
  if (!value) return { subtle: false };
  if (/^(#|rgb|hsl|oklch)/.test(value)) return { color: value, subtle: false };
  const subtle = value.endsWith('-subtle');
  const base = subtle ? value.slice(0, -'-subtle'.length) : value;
  if (!(base in STYLE_TOKEN_VAR)) return { color: value, subtle };
  return { color: tokenColor(base), subtle };
}

type Rgb = { r: number; g: number; b: number };
const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(Number.isFinite(n) ? n : 0)));
const rgbToHex = ({ r, g, b }: Rgb) =>
  '#' + [r, g, b].map((n) => clamp255(n).toString(16).padStart(2, '0')).join('');

/** Any CSS color (hex/rgb/hsl/token-resolved) → {r,g,b}, via a throwaway canvas
 *  (the browser normalizes `fillStyle`). Falls back to mid-grey. */
function cssToRgb(css?: string): Rgb {
  const fallback: Rgb = { r: 136, g: 136, b: 136 };
  if (!css) return fallback;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return fallback;
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    const s = ctx.fillStyle; // normalized to #rrggbb (opaque) or rgba(...)
    if (/^#[0-9a-f]{6}$/i.test(s))
      return { r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16) };
    const m = s.match(/(\d+)\D+(\d+)\D+(\d+)/);
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  } catch { /* jsdom / no canvas — fall through */ }
  return fallback;
}

/** Current value → RGB for the sliders. Parses hex fast; resolves tokens/other via canvas. */
function parseRgb(value?: string): Rgb {
  if (value && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
    let h = value.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  return cssToRgb(resolveDisplayColor(value).color);
}

/** Live preview of a style: a node-like box with its resolved fill/border/shape,
 *  the badge, and an emphasis ring — so you see what you're building. */
const StyleSwatch = ({ style }: { style: ElementStyle }) => {
  const fill = resolveDisplayColor(style.fill);
  const border = resolveDisplayColor(style.border);
  const bg = fill.color
    ? (fill.subtle ? `color-mix(in srgb, ${fill.color} 18%, transparent)` : fill.color)
    : 'var(--bg-raised)';
  return (
    <span
      aria-hidden
      title="preview"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 44, height: 28, flex: '0 0 auto',
        borderRadius: style.shape === 'hexagon' ? 3 : style.shape === 'ellipse' ? 14 : 7,
        background: bg,
        borderStyle: style.borderStyle ?? 'solid',
        borderWidth: Math.min(style.borderWidth ?? 1.5, 4),
        borderColor: border.color ?? 'var(--border-strong)',
        opacity: style.opacity ?? 1,
        boxShadow: style.emphasis ? '0 0 0 2px var(--accent), 0 1px 3px rgba(0,0,0,0.15)' : undefined,
        fontSize: 9, fontWeight: 700, letterSpacing: 0.2,
        color: resolveDisplayColor(style.textColor).color ?? 'var(--text)',
      }}
    >
      {style.badge}
    </span>
  );
};

/** Standard preset swatches — a greyscale ramp then common hues — for quick
 *  selection. The text field still accepts theme tokens (primary/neutral/…). */
const COLOR_PRESETS = [
  '#111827', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#ffffff',
  '#dc2626', '#ea580c', '#d97706', '#059669', '#2563eb', '#7c3aed', '#db2777',
];

/** A color field that accepts a theme token OR hex (text). The swatch button opens
 *  a popover with standard preset swatches. Exported for unit testing. */
export function ColorInput({ value, onChange, placeholder }: { value?: string; onChange: (v: string | undefined) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  // Escape closes; outside clicks are caught by the backdrop below (no document
  // mousedown listener — that conflicted with the preset buttons' own click).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const shown = resolveDisplayColor(value); // preview the real color for tokens too
  const rgb = parseRgb(value); // current color for the precise RGB sliders
  const setCh = (ch: keyof Rgb, v: number) => onChange(rgbToHex({ ...rgb, [ch]: clamp255(v) }));
  return (
    <div style={{ position: 'relative', display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
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
          // longhand backgroundColor (NOT the `background` shorthand) so it never
          // conflicts with backgroundImage on re-render — that mismatch left the
          // swatch color stuck on a second selection.
          backgroundColor: shown.color
            ? (shown.subtle ? `color-mix(in srgb, ${shown.color} 22%, var(--bg-raised))` : shown.color)
            : 'var(--bg-raised)',
          border: '1px solid var(--border)',
          // no color set → a diagonal hint so it reads as "unset"
          backgroundImage: shown.color ? 'none' : 'linear-gradient(135deg, transparent 46%, var(--border-strong) 46%, var(--border-strong) 54%, transparent 54%)',
        }}
      />
      {open && (
        <div
          role="dialog"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 60,
            background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 8,
            padding: 8, boxShadow: 'var(--shadow-lg)', width: 200,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {/* Reset: clear the color back to unset (inherit the default). */}
            <button
              type="button"
              title="None (clear)"
              aria-label="Clear color"
              onClick={() => { onChange(undefined); setTimeout(() => setOpen(false), 0); }}
              style={{
                width: 18, height: 18, padding: 0, borderRadius: 3, cursor: 'pointer',
                backgroundColor: 'var(--bg-raised)',
                backgroundImage: 'linear-gradient(135deg, transparent 44%, var(--danger) 44%, var(--danger) 56%, transparent 56%)',
                border: !value ? '2px solid var(--accent)' : '1px solid var(--border)',
              }}
            />
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                aria-label={`Use ${c}`}
                // Apply the color and close (deferred so the button survives the
                // click). Esc / the swatch also close the popover.
                onClick={() => { onChange(c); setTimeout(() => setOpen(false), 0); }}
                style={{
                  width: 18, height: 18, padding: 0, borderRadius: 3, cursor: 'pointer', backgroundColor: c,
                  border: value?.toLowerCase() === c ? '2px solid var(--accent)' : '1px solid var(--border)',
                  boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px var(--border)' : undefined,
                }}
              />
            ))}
          </div>

          {/* Precise RGB picker — a custom DOM control (NOT <input type="color">,
              which opens the blocking OS color panel). Sliders + numeric fields set
              an exact hex live. */}
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtle)' }}>Precise (RGB)</span>
              <span
                aria-hidden
                style={{ width: 16, height: 16, borderRadius: 3, border: '1px solid var(--border)', backgroundColor: rgbToHex(rgb) }}
              />
            </div>
            {(['r', 'g', 'b'] as const).map((ch) => (
              <div key={ch} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ width: 9, fontSize: 10, textTransform: 'uppercase', color: 'var(--text-subtle)' }}>{ch}</span>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={rgb[ch]}
                  aria-label={`${ch.toUpperCase()} channel`}
                  onChange={(e) => setCh(ch, +e.target.value)}
                  style={{ flex: '1 1 auto', minWidth: 0, accentColor: ch === 'r' ? '#dc2626' : ch === 'g' ? '#059669' : '#2563eb' }}
                />
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={rgb[ch]}
                  aria-label={`${ch.toUpperCase()} value`}
                  onChange={(e) => setCh(ch, +e.target.value)}
                  style={{ ...fieldStyleMono, width: 42, flexShrink: 0, textAlign: 'right', padding: '2px 4px' }}
                />
              </div>
            ))}
          </div>

          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-subtle)' }}>
            The ⟋ swatch clears the color. For a theme token, type it in the field. Esc to close.
          </div>
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
