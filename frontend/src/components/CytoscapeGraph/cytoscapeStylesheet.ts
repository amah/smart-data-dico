import type { StylesheetStyle } from 'cytoscape';
import { emphasisLevel, type ElementStyle } from '../../utils/elementStyle';

// Theme-token → DaisyUI CSS var, so Element Styles reference semantic colors
// (primary/neutral/warning/…) that adapt to the active theme instead of raw hex.
const STYLE_TOKEN_VAR: Record<string, string> = {
  primary: '--p', 'primary-content': '--pc', neutral: '--n', accent: '--accent',
  base: '--b1', 'base-content': '--bc', warning: '--wa', error: '--er', success: '--su', info: '--in',
};

const SERVICE_COLORS = [
  '#3498db', '#2ecc71', '#e74c3c', '#9b59b6', '#f1c40f',
  '#1abc9c', '#e67e22', '#34495e', '#16a085', '#d35400',
];

/**
 * A distinct colour for the i-th package. The first ten use a hand-picked
 * palette; beyond that the hue is rotated by the golden angle (~137.5°) with
 * two lightness levels, so even 100+ packages get distinguishable colours
 * instead of cycling through the same ten. (The box label is the primary
 * identifier; colour is a secondary cue.)
 */
export function packageColor(i: number): string {
  if (i < SERVICE_COLORS.length) return SERVICE_COLORS[i];
  const hue = Math.round((i * 137.508) % 360);
  const lightness = i % 2 === 0 ? 45 : 58;
  return `hsl(${hue}, 62%, ${lightness}%)`;
}

export function buildServiceColorMap(services: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  services.forEach((s, i) => {
    map[s] = packageColor(i);
  });
  return map;
}

/**
 * Convert any CSS color to a hex string that Cytoscape can use.
 * DaisyUI v3 stores raw HSL values (e.g. "212 18% 14%"), v4 uses oklch.
 * We try hsl() first, then oklch(), then the raw value.
 */
function cssColorToHex(color: string): string | null {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    // Reset to a known value to detect failures
    ctx.fillStyle = '#123456';
    ctx.fillStyle = color;
    if (ctx.fillStyle !== '#123456') return ctx.fillStyle;
    return null;
  } catch {
    return null;
  }
}

function resolveColor(cssVar: string, fallback: string): string {
  const val = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  if (!val) return fallback;

  // If it's already a standard color format, convert directly
  if (val.startsWith('#') || val.startsWith('rgb') || val.startsWith('hsl(') || val.startsWith('oklch(')) {
    return cssColorToHex(val) || fallback;
  }

  // DaisyUI v3: raw HSL values like "212 18% 14%"
  // Try wrapping as hsl() first
  const asHsl = cssColorToHex(`hsl(${val})`);
  if (asHsl) return asHsl;

  // DaisyUI v4: raw oklch values like "0.21 0.02 264"
  const asOklch = cssColorToHex(`oklch(${val})`);
  if (asOklch) return asOklch;

  return fallback;
}

/** Resolve an Element-Style color: a theme token (adapts to theme), a `*-subtle`
 *  variant, or a raw CSS color passed through. */
function styleColor(name: string | undefined): string | undefined {
  if (!name) return undefined;
  if (/^(#|rgb|hsl|oklch)/.test(name)) return name;
  const base = name.endsWith('-subtle') ? name.slice(0, -'-subtle'.length) : name;
  const cssVar = STYLE_TOKEN_VAR[base];
  return cssVar ? resolveColor(cssVar, name) : name;
}

/** One `node[styleName="…"]` selector per named Element Style (#element-style).
 *  Placed after the base/pk selectors so a style overrides the default border. */
/** Greyscale font ramp by emphasis level (index 0–3): the label darkens as emphasis
 *  rises, but the base level stays well visible. Applied as text-opacity over the
 *  theme's base-content so it stays greyscale and adapts to dark/light. */
const FONT_OPACITY_BY_LEVEL = [0.75, 0.83, 0.92, 1] as const;

export function buildElementStyleSelectors(elementStyles: ElementStyle[]): StylesheetStyle[] {
  return elementStyles.filter((s) => s?.name).map((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const style: any = {};
    const lvl = emphasisLevel(s.emphasis);
    const fill = styleColor(s.fill);
    // `-subtle` fills render as a light wash; keep it faint so the inner fill stays light.
    // Emphasis gates the wash: only level 3 (strong) shows a fill; 1–2 stay unfilled.
    if (fill && !(lvl > 0 && lvl < 3)) { style['background-color'] = fill; if (s.fill?.endsWith('-subtle')) style['background-opacity'] = 0.08; }
    const border = styleColor(s.border);
    if (border) style['border-color'] = border;
    // Explicit borderWidth wins; else emphasis level sets it (1 → thin, 2/3 → thick).
    if (s.borderWidth != null) style['border-width'] = s.borderWidth;
    else if (lvl > 0) style['border-width'] = lvl === 1 ? 2 : 4;
    if (s.borderStyle) style['border-style'] = s.borderStyle;
    if (s.shape) style['shape'] = s.shape;
    if (s.opacity != null) style['opacity'] = s.opacity;
    const text = styleColor(s.textColor);
    if (text) {
      style['color'] = text; // explicit textColor wins
    } else {
      // Greyscale font ramp: base stays readable, darkening up to the top level.
      style['color'] = styleColor('base-content');
      style['text-opacity'] = FONT_OPACITY_BY_LEVEL[lvl];
    }
    // Emphasis draws the node above others (border weight handled above, fill gated) —
    // no overlay tint, so it reads through its border, not a coloured wash.
    if (lvl > 0) { style['z-index'] = 20; }
    return { selector: `node[styleName = "${s.name}"]`, style };
  });
}

export function createStylesheet(serviceColorMap: Record<string, string>, elementStyles: ElementStyle[] = []): StylesheetStyle[] {
  const bg = resolveColor('--b1', '#ffffff');
  const fg = resolveColor('--bc', '#1f2937');
  const primary = resolveColor('--p', '#570df8');
  const primaryContent = resolveColor('--pc', '#ffffff');
  const neutral = resolveColor('--n', '#2a323c');
  const accent = resolveColor('--accent', primary);
  const bgRaised = resolveColor('--bg-raised', bg);

  const sheets: StylesheetStyle[] = [
    // Node base — two-line UML-style compartment
    {
      selector: 'node[type = "entity"]',
      style: {
        label: 'data(displayLabel)',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '160px',
        'line-height': 1.3,
        'background-color': bg,
        'border-width': 2,
        'border-color': neutral,
        color: fg,
        'font-size': 13,
        'font-weight': 'bold',
        'font-family': 'ui-sans-serif, system-ui, sans-serif',
        width: 180,
        height: 60,
        shape: 'roundrectangle',
        'transition-property': 'border-width, border-color, overlay-opacity',
        'transition-duration': 150,
      } as any,
    },
    // Node hover (class toggled from useCytoscapeInteractions)
    {
      selector: 'node[type = "entity"].hover',
      style: {
        'border-width': 3,
        'z-index': 5,
        'overlay-opacity': 0.08,
        'overlay-color': accent,
      } as any,
    },
    // PK indicator
    {
      selector: 'node[pkCount > 0]',
      style: {
        'border-color': primary,
        'border-width': 3,
      } as any,
    },
    // Compound (package) nodes
    {
      selector: ':parent',
      style: {
        'background-color': neutral,
        'background-opacity': 0.06,
        'border-style': 'dashed',
        'border-width': 2,
        'border-color': neutral,
        'border-opacity': 0.4,
        'text-valign': 'top',
        'text-halign': 'center',
        'font-weight': 'bold',
        'font-size': 15,
        'text-margin-y': -6,
        padding: '28px',
        label: 'data(label)',
        color: fg,
      } as any,
    },
    // Edge base. Arrowheads are NOT drawn by default — they are added per
    // navigability (#bidi): an arrowhead sits at an end iff that end is named
    // (navigable). A relationship navigable both ways → a single double-headed
    // edge; reciprocal relationship records are merged into one (mergeEdges.ts).
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': neutral,
        'line-opacity': 0.7,
        'target-arrow-color': neutral,
        'target-arrow-shape': 'none',
        'arrow-scale': 1.2,
        'curve-style': 'bezier',
        // Show endpoint role + cardinality glyph (`*` for many, `1` for one)
        // rather than the raw "one"/"many" words. Pre-formatted in
        // mapGraphDataToCytoscape.formatEndLabel().
        'source-label': 'data(sourceEndLabel)',
        'target-label': 'data(targetEndLabel)',
        'source-text-offset': 22,
        'target-text-offset': 22,
        'font-size': 11,
        'font-family': 'ui-sans-serif, system-ui, sans-serif',
        color: fg,
        'text-background-color': bg,
        'text-background-opacity': 0.9,
        'text-background-padding': '3px',
        'text-background-shape': 'roundrectangle',
      } as any,
    },
    // ── Logical (ORM) view ────────────────────────────────────────────────
    // Association edge: show the ORM annotation (fetch/cascade/orphan) as a
    // mid-edge label, in addition to the cardinality glyphs on each end.
    {
      selector: 'edge[edgeKind = "association"]',
      style: {
        label: 'data(label)',
        // Keep the annotation HORIZONTAL (not autorotated): on a vertical edge
        // autorotate ran the text down the line, overlapping the role/cardinality
        // end labels and turning it into unreadable vertical text. Nudge it off
        // the line so it sits beside the edge midpoint.
        'text-rotation': 'none',
        'text-margin-x': 6,
        'font-size': 10,
        'font-style': 'italic',
        color: fg,
        'text-background-color': bg,
        'text-background-opacity': 0.92,
        'text-background-padding': '2px',
      } as any,
    },
    // UML edge decorations (structural + logical association edges), driven by
    // per-edge `sourceArrow` / `targetArrow` shape data (#uml):
    //   - 'vee'     → open navigability arrow (one-way reference);
    //   - 'diamond' → filled diamond at the whole (composition);
    //   - 'none'    → no decoration (e.g. a bidirectional reference = plain line).
    {
      selector: 'edge[targetArrow = "vee"]',
      style: { 'target-arrow-shape': 'vee', 'target-arrow-color': neutral, 'arrow-scale': 1.2 } as any,
    },
    {
      selector: 'edge[sourceArrow = "vee"]',
      style: { 'source-arrow-shape': 'vee', 'source-arrow-color': neutral, 'arrow-scale': 1.2 } as any,
    },
    {
      selector: 'edge[targetArrow = "diamond"]',
      style: {
        'target-arrow-shape': 'diamond',
        'target-arrow-fill': 'filled',
        'target-arrow-color': neutral,
        'arrow-scale': 1.3,
      } as any,
    },
    {
      selector: 'edge[sourceArrow = "diamond"]',
      style: {
        'source-arrow-shape': 'diamond',
        'source-arrow-fill': 'filled',
        'source-arrow-color': neutral,
        'arrow-scale': 1.3,
      } as any,
    },
    // Inheritance ("is-a") edge (#185) — UML generalization: a solid line with a
    // hollow triangle pointing at the superclass. Distinct from associations,
    // with no cardinality glyphs; labelled with the root's inheritance strategy.
    {
      selector: 'edge[edgeKind = "inheritance"]',
      style: {
        label: 'data(label)',
        'line-color': fg,
        'line-opacity': 0.8,
        'line-style': 'solid',
        width: 1.5,
        'target-arrow-shape': 'triangle',
        'target-arrow-fill': 'hollow',
        'target-arrow-color': fg,
        'source-arrow-shape': 'none',
        'arrow-scale': 1.6,
        'source-label': '',
        'target-label': '',
        'font-size': 9,
        'font-style': 'italic',
        color: fg,
        'text-background-color': bg,
        'text-background-opacity': 0.9,
      } as any,
    },
    // ── Physical (table) view ─────────────────────────────────────────────
    // FK edge: a solid arrow to the referenced table, labelled with the join
    // column(s). No cardinality glyphs.
    {
      selector: 'edge[edgeKind = "fk"]',
      style: {
        label: 'data(label)',
        'line-color': neutral,
        'line-opacity': 0.7,
        'target-arrow-shape': 'triangle',
        'target-arrow-color': neutral,
        'source-label': '',
        'target-label': '',
        'font-size': 9,
        color: fg,
        'text-background-color': bg,
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
      } as any,
    },
    // Join-table node (synthetic, for many-to-many): a distinct cut-corner
    // rectangle so it reads apart from real tables.
    {
      selector: 'node[type = "jointable"]',
      style: {
        label: 'data(displayLabel)',
        'text-valign': 'center',
        'text-halign': 'center',
        'background-color': bgRaised,
        'border-width': 2,
        'border-style': 'dashed',
        'border-color': accent,
        color: fg,
        'font-size': 11,
        'font-style': 'italic',
        shape: 'cutrectangle',
        width: 120,
        height: 40,
      } as any,
    },
    // ── Logical↔physical drift overlay (#187) ─────────────────────────────
    // "not enforced in DB": a logical relationship with no backing FK — dashed
    // amber warning edge.
    {
      selector: 'edge[edgeKind = "drift"]',
      style: {
        label: 'data(label)',
        'line-color': '#f59e0b',
        'line-style': 'dashed',
        'line-opacity': 0.9,
        width: 2,
        'target-arrow-shape': 'none',
        'source-label': '',
        'target-label': '',
        'font-size': 9,
        color: '#b45309',
        'text-background-color': bg,
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
      } as any,
    },
    // "in DB, missing from model": an FK with no logical relationship — recolour
    // the FK edge as an amber warning.
    {
      selector: 'edge[?driftInDb]',
      style: {
        'line-color': '#f59e0b',
        'line-style': 'dashed',
        'target-arrow-color': '#f59e0b',
        width: 2,
        color: '#b45309',
      } as any,
    },
    // Selected
    {
      selector: ':selected',
      style: {
        'background-color': primary,
        color: primaryContent,
        'border-color': primary,
        'line-color': primary,
        'target-arrow-color': primary,
      } as any,
    },
    // Dimmed (search filter)
    {
      selector: '.dimmed',
      style: {
        opacity: 0.15,
      } as any,
    },
    // Highlighted (search match)
    {
      selector: '.highlighted',
      style: {
        'border-color': primary,
        'border-width': 4,
        'z-index': 10,
      } as any,
    },
    // Expanded node — UML class compartment (header + separator + attribute list)
    {
      selector: 'node[?expanded]',
      style: {
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': 6,
        'font-size': 11,
        'font-weight': 'normal',
        'background-color': bgRaised,
        'border-color': accent,
        'border-width': 2,
        'text-max-width': '220px',
        'padding-top': '6px',
        'padding-bottom': '6px',
        'padding-left': '8px',
        'padding-right': '8px',
        color: fg,
      } as any,
    },
    // ── Focus mode (double-click / Focus button) ──────────────────────────
    // Non-neighbour elements recede; the focused entity and its direct
    // neighbours stay prominent.
    {
      selector: '.focus-dim',
      style: { opacity: 0.12 } as any,
    },
    {
      selector: 'node.focus-root',
      style: {
        'border-color': primary,
        'border-width': 4,
        'border-style': 'double',
        'background-color': bgRaised,
        // Force a readable label colour: the focused node may also be :selected
        // (double-click selects it), whose white text would be invisible here.
        color: fg,
        'text-opacity': 1,
        'z-index': 20,
      } as any,
    },
    {
      selector: 'node.focus-neighbor',
      style: {
        'border-color': accent,
        'border-width': 2,
        'z-index': 10,
      } as any,
    },
    // Case overlay styles (renamed from perspective in #121)
    {
      selector: '.case-root',
      style: {
        'border-width': 5,
        'border-color': '#e74c3c',
        'border-style': 'double',
        'z-index': 10,
      } as any,
    },
    {
      selector: '.case-member',
      style: {
        'border-width': 3,
        'border-color': '#2ecc71',
      } as any,
    },
    {
      selector: '.case-frontier',
      style: {
        'border-width': 3,
        'border-color': '#f39c12',
        'border-style': 'dashed',
      } as any,
    },
    // Connect mode: source node glow
    {
      selector: '.connect-source',
      style: {
        'border-width': 4,
        'border-color': primary,
        'border-style': 'double',
        'z-index': 20,
      } as any,
    },
    // Connect mode: potential targets pulse
    {
      selector: '.connect-target-hint',
      style: {
        'border-width': 2,
        'border-style': 'dashed',
        'border-color': primary,
        opacity: 0.8,
      } as any,
    },
  ];

  // Per-package colour applies to the bounding BOX (compound node), not to each
  // entity node — packages are delimited by a labelled box, so individual nodes
  // keep a uniform border.
  for (const [service, color] of Object.entries(serviceColorMap)) {
    sheets.push({
      selector: `:parent[service = "${service}"]`,
      style: {
        'border-color': color,
        'border-opacity': 0.9,
        'border-width': 2,
      } as any,
    });
  }

  // Element Styles (#element-style): one selector per named style, after the base
  // + pk selectors so `styleName` overrides the default node styling.
  sheets.push(...buildElementStyleSelectors(elementStyles));

  return sheets;
}
