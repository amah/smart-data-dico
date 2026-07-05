/**
 * Format painter (#element-style) — style entities straight from the diagram,
 * PowerPoint-style. A "format" is a named Element Style; the painter holds one in
 * a clipboard (copied from an entity or picked from the list) and applies it to
 * tapped entities:
 *
 *   - copyStyle(name) puts a style on the clipboard.
 *   - toggle()/arm()/disarm() control the brush. While armed, a node tap is
 *     intercepted (see interceptTap) and the clipboard style is applied instead of
 *     opening the info panel. One-shot by default; sticky (double-click the brush)
 *     keeps it armed to paint many.
 *   - applyToNode persists the override (system.style) AND restyles the node live
 *     (styleName data attribute + «badge» in the label) so the canvas updates
 *     without a reload.
 *
 * `null`/'default' clears the override (falls back to rules/role detection). The
 * label/badge transform is a pure helper (labelWithBadge) so it's unit-tested
 * without a Cytoscape instance.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Core, NodeSingular } from 'cytoscape';
import { servicesApi } from '../../services/api';
import type { ElementStyle } from '../../utils/elementStyle';

/** Sentinel clipboard value meaning "clear the style (back to default)". */
export const CLEAR_STYLE = '__default__';

/** Recompute a node's display label for a (possibly absent) style badge: strip any
 *  existing «tag» line, then append the new one. Pure — no Cytoscape needed. */
export function labelWithBadge(baseLabel: string, badge?: string): string {
  const name = String(baseLabel ?? '').split('\n')[0]; // drop any prior «badge» line
  return badge ? `${name}\n«${badge}»` : name;
}

export interface FormatPainter {
  /** Style name on the clipboard, CLEAR_STYLE, or null when empty. */
  clipboard: string | null;
  armed: boolean;
  sticky: boolean;
  /** Put a style (or CLEAR_STYLE) on the clipboard without arming. */
  copyStyle: (name: string | null) => void;
  /** Copy the given style AND arm the brush (info-panel "Copy format"). */
  copyAndArm: (name: string | null) => void;
  /** Toggle the brush on/off (one-shot). */
  toggle: () => void;
  /** Arm the brush and keep it armed after each paint (double-click the brush). */
  armSticky: () => void;
  disarm: () => void;
  /** Apply a style to one entity node now (used by the info-panel list + Paste). */
  applyToNode: (node: NodeSingular, styleName: string | null) => Promise<void>;
  /** Node-tap interceptor for useCytoscapeInteractions: paints + returns true when armed. */
  interceptTap: (node: NodeSingular) => boolean;
}

export function useFormatPainter(
  cy: Core | null,
  styles: ElementStyle[],
  fallbackService?: string,
  onApplied?: (service: string, entity: string, styleName: string | null) => void,
): FormatPainter {
  const [clipboard, setClipboard] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [sticky, setSticky] = useState(false);

  // Refs so the tap interceptor (bound once inside the interactions hook) always
  // reads the latest state without re-binding.
  const clipboardRef = useRef<string | null>(null);
  const armedRef = useRef(false);
  const stickyRef = useRef(false);
  clipboardRef.current = clipboard;
  armedRef.current = armed;
  stickyRef.current = sticky;

  const styleByName = useMemo(() => new Map(styles.map((s) => [s.name, s])), [styles]);
  const stylesRef = useRef(styleByName);
  stylesRef.current = styleByName;
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;
  const fallbackServiceRef = useRef(fallbackService);
  fallbackServiceRef.current = fallbackService;

  const applyToNode = useCallback(async (node: NodeSingular, styleName: string | null) => {
    const clear = !styleName || styleName === CLEAR_STYLE;
    const service = (node.data('service') as string) || fallbackServiceRef.current || '';
    const entity = (node.data('name') as string) || (node.data('label') as string);
    if (!service || !entity) return;

    // 1) Live restyle: styleName drives the node[styleName="…"] selectors; refresh
    //    the «badge» line in the label from the resolved style.
    const badge = clear ? undefined : stylesRef.current.get(styleName!)?.badge;
    if (clear) node.removeData('styleName');
    else node.data('styleName', styleName);
    node.data('displayLabel', labelWithBadge((node.data('label') as string) || '', badge));

    // 2) Persist the override (non-destructive system.style metadata).
    try {
      await servicesApi.setEntityStyle(service, entity, clear ? null : styleName);
      onAppliedRef.current?.(service, entity, clear ? null : styleName!);
    } catch {
      /* keep the live change; the next reload re-resolves from persisted state */
    }
  }, []);

  const interceptTap = useCallback((node: NodeSingular): boolean => {
    if (!armedRef.current || clipboardRef.current === null) return false;
    void applyToNode(node, clipboardRef.current);
    if (!stickyRef.current) { setArmed(false); }
    return true; // handled — suppress the info panel
  }, [applyToNode]);

  const copyStyle = useCallback((name: string | null) => {
    setClipboard(name ?? CLEAR_STYLE);
  }, []);

  const copyAndArm = useCallback((name: string | null) => {
    setClipboard(name ?? CLEAR_STYLE);
    setArmed(true);
  }, []);

  const toggle = useCallback(() => { setArmed((a) => !a); setSticky(false); }, []);
  const armSticky = useCallback(() => { setArmed(true); setSticky(true); }, []);
  const disarm = useCallback(() => { setArmed(false); setSticky(false); }, []);

  // Esc disarms the brush (mirrors focus-mode Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && armedRef.current) disarm(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [disarm]);

  // Reflect the armed brush as a canvas cursor hint.
  useEffect(() => {
    const el = cy?.container();
    if (el) el.style.cursor = armed ? 'copy' : '';
    return () => { if (el) el.style.cursor = ''; };
  }, [cy, armed]);

  return { clipboard, armed, sticky, copyStyle, copyAndArm, toggle, armSticky, disarm, applyToNode, interceptTap };
}
