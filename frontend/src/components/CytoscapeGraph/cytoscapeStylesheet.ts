import type { StylesheetStyle } from 'cytoscape';

const SERVICE_COLORS = [
  '#3498db', '#2ecc71', '#e74c3c', '#9b59b6', '#f1c40f',
  '#1abc9c', '#e67e22', '#34495e', '#16a085', '#d35400',
];

export function buildServiceColorMap(services: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  services.forEach((s, i) => {
    map[s] = SERVICE_COLORS[i % SERVICE_COLORS.length];
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

export function createStylesheet(serviceColorMap: Record<string, string>): StylesheetStyle[] {
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
    // Edge base
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': neutral,
        'line-opacity': 0.7,
        'target-arrow-color': neutral,
        'target-arrow-shape': 'triangle',
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
        'text-rotation': 'autorotate',
        'text-margin-y': -8,
        'font-size': 10,
        'font-style': 'italic',
        color: fg,
        'text-background-color': bg,
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
      } as any,
    },
    // Owning side: when the target end owns the mapping, draw the navigability
    // arrow at the source end instead of the default target end.
    {
      selector: 'edge[?arrowAtSource]',
      style: {
        'target-arrow-shape': 'none',
        'source-arrow-shape': 'triangle',
        'source-arrow-color': neutral,
        'arrow-scale': 1.2,
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

  // Per-service color selectors
  for (const [service, color] of Object.entries(serviceColorMap)) {
    sheets.push({
      selector: `node[service = "${service}"]`,
      style: {
        'border-color': color,
        'border-width': 2,
      } as any,
    });
  }

  return sheets;
}
