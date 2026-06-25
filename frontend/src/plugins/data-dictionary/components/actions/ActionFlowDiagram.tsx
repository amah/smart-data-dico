/**
 * ActionFlowDiagram — top-down flowchart view of an action's flow (#201, Phase 1).
 *
 * Renders the action's `FlowStep[]` tree (via the pure {@link flowToGraph}
 * mapper) on the shared Cytoscape stack with a `dagre` top-down layout. Pure
 * view: nothing is executed or validated — the opaque step strings are shown
 * as-is, mirroring the per-kind colours of {@link ActionFlowList}.
 *
 * `invokeAction` nodes that resolve to a sibling action (same entity) become
 * clickable and call `onNavigateAction(uuid)` so the parent tab can jump to
 * the referenced action's flow.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ElementDefinition, StylesheetStyle } from 'cytoscape';
import type { Action, FlowStepKind } from '../../../../types';
import { useCytoscapeInstance } from '../../../../components/CytoscapeGraph/useCytoscapeInstance';
import { useCytoscapeLayout } from '../../../../components/CytoscapeGraph/useCytoscapeLayout';
import { STEP_KIND_COLORS, STEP_KIND_LABELS } from './ActionFlowList';
import { flowToGraph, type FlowGraph, type FlowNodeKind } from './flowToGraph';

interface ActionFlowDiagramProps {
  action: Action;
  /** Sibling actions (same entity) used to resolve `invokeAction` refs. */
  actions?: Action[];
  /** Called when a resolvable `invokeAction` node is clicked. */
  onNavigateAction?: (uuid: string) => void;
  /** Canvas height in px. */
  height?: number;
}

// ── Pure element building (unit-testable, no Cytoscape runtime) ────────────────

/**
 * Map a {@link FlowGraph} to Cytoscape elements. `resolveActionName` turns an
 * `invokeAction` ref into a display name when known; resolvable invoke nodes
 * are tagged `navigable = 1` so a tap handler can open them.
 */
export function flowGraphToElements(
  graph: FlowGraph,
  resolveActionName?: (ref: string) => string | undefined,
): ElementDefinition[] {
  const nodes: ElementDefinition[] = graph.nodes.map((n) => {
    const resolved =
      n.kind === 'invokeAction' && n.actionRef ? resolveActionName?.(n.actionRef) : undefined;
    return {
      data: {
        id: n.id,
        kind: n.kind,
        label: resolved ?? n.label,
        actionRef: n.actionRef,
        navigable: resolved ? 1 : 0,
      },
    };
  });

  const edges: ElementDefinition[] = graph.edges.map((e) => ({
    data: { id: e.id, source: e.source, target: e.target, label: e.label ?? '' },
  }));

  return [...nodes, ...edges];
}

// ── Theme-token resolution (CSS var → hex Cytoscape can paint) ─────────────────

/** Per-kind hard fallbacks, used only when a CSS var can't be resolved (jsdom). */
const KIND_FALLBACK: Record<FlowNodeKind, string> = {
  assign: '#570df8',
  emitEvent: '#16a34a',
  invokeAction: '#570df8',
  branch: '#d97706',
  wait: '#6b7280',
  callExternal: '#dc2626',
  start: '#6b7280',
  end: '#6b7280',
};

/** Cytoscape shape per node kind — mirrors the list's semantics visually. */
const KIND_SHAPE: Record<FlowNodeKind, string> = {
  start: 'ellipse',
  end: 'ellipse',
  assign: 'roundrectangle',
  emitEvent: 'tag', // event marker
  invokeAction: 'roundrectangle',
  branch: 'diamond', // conditional fork
  wait: 'hexagon',
  callExternal: 'cutrectangle', // external boundary
};

function cssColorToHex(color: string): string | null {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#123456';
    ctx.fillStyle = color;
    if (ctx.fillStyle !== '#123456') return ctx.fillStyle;
    return null;
  } catch {
    return null;
  }
}

/** Resolve a `--token` to a hex colour, falling back when unavailable. */
function resolveVar(token: string, fallback: string): string {
  const val = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (!val) return fallback;
  if (val.startsWith('#') || val.startsWith('rgb') || val.startsWith('hsl(') || val.startsWith('oklch(')) {
    return cssColorToHex(val) || fallback;
  }
  return cssColorToHex(`hsl(${val})`) || cssColorToHex(`oklch(${val})`) || fallback;
}

/** Resolve a kind's colour from the shared {@link STEP_KIND_COLORS} token. */
function resolveKindColor(kind: FlowNodeKind): string {
  const fallback = KIND_FALLBACK[kind];
  const raw = STEP_KIND_COLORS[kind as FlowStepKind];
  const match = raw?.match(/var\((--[a-z-]+)\)/i);
  if (match) return resolveVar(match[1], fallback);
  return fallback;
}

function createFlowStylesheet(): StylesheetStyle[] {
  const fg = resolveVar('--text', '#1f2937');
  const border = resolveVar('--border', '#d1d5db');
  const bgRaised = resolveVar('--bg-raised', '#ffffff');

  const kinds: FlowNodeKind[] = [
    'start', 'end', 'assign', 'emitEvent', 'invokeAction', 'branch', 'wait', 'callExternal',
  ];

  const sheets: StylesheetStyle[] = [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '150px',
        'font-size': 12,
        'font-family': 'monospace',
        color: fg,
        'background-color': bgRaised,
        'border-width': 2,
        width: 170,
        height: 48,
        shape: 'roundrectangle',
      } as any,
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': border,
        'target-arrow-color': border,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 1.1,
        'curve-style': 'bezier',
        label: 'data(label)',
        'font-size': 10,
        'font-style': 'italic',
        color: fg,
        'text-background-color': bgRaised,
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
      } as any,
    },
    // Resolvable invoke nodes read as links.
    {
      selector: 'node[navigable = 1]',
      style: { 'border-style': 'double', 'border-width': 4 } as any,
    },
  ];

  for (const kind of kinds) {
    const color = resolveKindColor(kind);
    sheets.push({
      selector: `node[kind = "${kind}"]`,
      style: {
        shape: KIND_SHAPE[kind],
        'border-color': color,
        'background-color': color,
        'background-opacity': 0.14,
      } as any,
    });
  }

  return sheets;
}

// ── Compact legend ─────────────────────────────────────────────────────────────

const LEGEND_KINDS: FlowStepKind[] = [
  'assign', 'emitEvent', 'invokeAction', 'branch', 'wait', 'callExternal',
];

function FlowLegend() {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        padding: '4px 8px',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        maxWidth: 'calc(100% - 16px)',
      }}
    >
      {LEGEND_KINDS.map((kind) => (
        <span key={kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              border: `2px solid ${STEP_KIND_COLORS[kind]}`,
              background: `${STEP_KIND_COLORS[kind]}22`,
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
            {STEP_KIND_LABELS[kind]}
          </span>
        </span>
      ))}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function ActionFlowDiagram({
  action,
  actions,
  onNavigateAction,
  height = 360,
}: ActionFlowDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const actionsByUuid = useMemo(
    () => new Map((actions ?? []).map((a) => [a.uuid, a])),
    [actions],
  );
  const resolveName = useCallback(
    (ref: string) => actionsByUuid.get(ref)?.name,
    [actionsByUuid],
  );

  const elements = useMemo(
    () => flowGraphToElements(flowToGraph(action), resolveName),
    [action, resolveName],
  );
  const stylesheet = useMemo(() => createFlowStylesheet(), []);

  const { cyRef, cy } = useCytoscapeInstance(containerRef, elements, stylesheet);
  const { runLayout } = useCytoscapeLayout(cyRef);

  // Run the top-down layout once the instance + elements are ready.
  useEffect(() => {
    if (!cy || cy.destroyed() || elements.length === 0) return;
    const timer = setTimeout(() => {
      if (!cy.destroyed()) runLayout('dagre', 'TB');
    }, 50);
    return () => clearTimeout(timer);
  }, [cy, elements, runLayout]);

  // Tap a resolvable invoke node → navigate to the referenced action.
  useEffect(() => {
    if (!cy || !onNavigateAction) return;
    const handler = (evt: { target: { data: (k: string) => unknown } }) => {
      const ref = evt.target.data('actionRef') as string | undefined;
      if (ref && actionsByUuid.has(ref)) onNavigateAction(ref);
    };
    cy.on('tap', 'node[navigable = 1]', handler as any);
    return () => {
      cy.removeListener('tap', 'node[navigable = 1]', handler as any);
    };
  }, [cy, onNavigateAction, actionsByUuid]);

  const isEmpty = !action.flow || action.flow.length === 0;

  return (
    <div
      style={{
        position: 'relative',
        height,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-raised)',
        overflow: 'hidden',
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height }} />
      {isEmpty && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            pointerEvents: 'none',
          }}
        >
          No steps to diagram
        </div>
      )}
      {!isEmpty && <FlowLegend />}
    </div>
  );
}
