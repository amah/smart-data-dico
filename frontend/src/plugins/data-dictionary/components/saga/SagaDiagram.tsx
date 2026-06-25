/**
 * SagaDiagram — package-scoped CQRS orchestration / process map (#201 Phase 3).
 *
 * Graphs every action + referenced event in a package into the end-to-end
 * command → events → reactions flow (see {@link actionsToSagaGraph}), rendered
 * on the shared Cytoscape stack with a left-to-right dagre layout. Action nodes
 * are coloured by CQRS classification (command / query / unclassified) and
 * internal actions are dashed; events render as markers. A legend lets you
 * filter commands vs queries. Modeling-only — nothing is executed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ElementDefinition, StylesheetStyle } from 'cytoscape';
import type { Action, Event, ActionKind } from '../../../../types';
import { actionsApi, eventsApi } from '../../../../services/api';
import { useCytoscapeInstance } from '../../../../components/CytoscapeGraph/useCytoscapeInstance';
import { useCytoscapeLayout } from '../../../../components/CytoscapeGraph/useCytoscapeLayout';
import { actionsToSagaGraph, type SagaGraph } from './actionsToSagaGraph';

interface SagaDiagramProps {
  /** Package whose actions + events are graphed. */
  service?: string;
}

/** Which action classifications are currently hidden. */
type Hidden = Partial<Record<'command' | 'query' | 'unclassified', boolean>>;

// ── Pure element building (unit-testable) ──────────────────────────────────────

const classOf = (n: { actionKind?: ActionKind }): 'command' | 'query' | 'unclassified' =>
  n.actionKind ?? 'unclassified';

/**
 * Map a {@link SagaGraph} to Cytoscape elements, applying the visibility filter:
 * hidden action classes are dropped along with their incident edges, and events
 * left with no edges are dropped too (keeps the canvas focused).
 */
export function sagaGraphToElements(graph: SagaGraph, hidden: Hidden = {}): ElementDefinition[] {
  const keptActionIds = new Set(
    graph.nodes
      .filter((n) => n.type === 'action' && !hidden[classOf(n)])
      .map((n) => n.id),
  );

  const edges = graph.edges.filter(
    (e) =>
      (graph.nodes.find((n) => n.id === e.source)?.type !== 'action' || keptActionIds.has(e.source)) &&
      (graph.nodes.find((n) => n.id === e.target)?.type !== 'action' || keptActionIds.has(e.target)),
  );

  // Events with at least one surviving edge.
  const liveEventIds = new Set<string>();
  for (const e of edges) {
    for (const id of [e.source, e.target]) {
      if (graph.nodes.find((n) => n.id === id)?.type === 'event') liveEventIds.add(id);
    }
  }

  const nodeEls: ElementDefinition[] = graph.nodes
    .filter((n) => (n.type === 'action' ? keptActionIds.has(n.id) : liveEventIds.has(n.id)))
    .map((n) => ({
      data: {
        id: n.id,
        nodeType: n.type,
        cls: n.type === 'action' ? classOf(n) : 'event',
        internal: n.internal ? 1 : 0,
        label: n.label,
      },
    }));

  const edgeEls: ElementDefinition[] = edges.map((e) => ({
    data: { id: e.id, source: e.source, target: e.target, kind: e.kind, label: e.kind },
  }));

  return [...nodeEls, ...edgeEls];
}

// ── Theme tokens → hex ─────────────────────────────────────────────────────────

const CLASS_COLOR_FALLBACK: Record<string, string> = {
  command: '#570df8',
  query: '#0ea5e9',
  unclassified: '#6b7280',
  event: '#16a34a',
};
const CLASS_TOKEN: Record<string, string> = {
  command: '--accent',
  query: '--info',
  unclassified: '--text-subtle',
  event: '--success',
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
function resolveVar(token: string, fallback: string): string {
  const val = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (!val) return fallback;
  if (val.startsWith('#') || val.startsWith('rgb') || val.startsWith('hsl(') || val.startsWith('oklch(')) {
    return cssColorToHex(val) || fallback;
  }
  return cssColorToHex(`hsl(${val})`) || cssColorToHex(`oklch(${val})`) || fallback;
}
const classColor = (cls: string) => resolveVar(CLASS_TOKEN[cls], CLASS_COLOR_FALLBACK[cls]);

function createSagaStylesheet(): StylesheetStyle[] {
  const fg = resolveVar('--text', '#1f2937');
  const border = resolveVar('--border', '#d1d5db');
  const bgRaised = resolveVar('--bg-raised', '#ffffff');

  const sheets: StylesheetStyle[] = [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '140px',
        'font-size': 12,
        'font-family': 'monospace',
        color: fg,
        'background-color': bgRaised,
        'border-width': 2,
        width: 150,
        height: 44,
        shape: 'roundrectangle',
      } as any,
    },
    {
      selector: 'node[nodeType = "event"]',
      style: {
        shape: 'tag',
        'border-color': classColor('event'),
        'background-color': classColor('event'),
        'background-opacity': 0.14,
        width: 130,
        height: 40,
      } as any,
    },
    { selector: 'node.internal-dashed', style: { 'border-style': 'dashed' } as any },
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
        'font-size': 9,
        'font-style': 'italic',
        color: fg,
        'text-background-color': bgRaised,
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
      } as any,
    },
    // react edges (event → action) read as reactions: dashed, success-tinted.
    {
      selector: 'edge[kind = "react"]',
      style: { 'line-style': 'dashed', 'line-color': classColor('event'), 'target-arrow-color': classColor('event') } as any,
    },
    // invoke edges (action → action) read as orchestration: accent.
    {
      selector: 'edge[kind = "invoke"]',
      style: { 'line-color': classColor('command'), 'target-arrow-color': classColor('command') } as any,
    },
  ];

  for (const cls of ['command', 'query', 'unclassified']) {
    sheets.push({
      selector: `node[cls = "${cls}"]`,
      style: {
        'border-color': classColor(cls),
        'background-color': classColor(cls),
        'background-opacity': 0.14,
      } as any,
    });
  }

  return sheets;
}

// ── Legend + filter ────────────────────────────────────────────────────────────

const LEGEND: { cls: 'command' | 'query' | 'unclassified' | 'event'; label: string; filterable: boolean }[] = [
  { cls: 'command', label: 'Command', filterable: true },
  { cls: 'query', label: 'Query', filterable: true },
  { cls: 'unclassified', label: 'Unclassified', filterable: true },
  { cls: 'event', label: 'Event', filterable: false },
];

function SagaLegend({ hidden, onToggle }: { hidden: Hidden; onToggle: (c: 'command' | 'query' | 'unclassified') => void }) {
  return (
    <div
      style={{
        position: 'absolute', bottom: 8, left: 8, display: 'flex', flexWrap: 'wrap', gap: 8,
        padding: '4px 8px', background: 'var(--bg-raised)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)', maxWidth: 'calc(100% - 16px)',
      }}
    >
      {LEGEND.map(({ cls, label, filterable }) => {
        const isHidden = filterable && hidden[cls as 'command' | 'query' | 'unclassified'];
        return (
          <button
            key={cls}
            onClick={filterable ? () => onToggle(cls as 'command' | 'query' | 'unclassified') : undefined}
            disabled={!filterable}
            title={filterable ? 'Toggle visibility' : undefined}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none',
              cursor: filterable ? 'pointer' : 'default', padding: 0, opacity: isHidden ? 0.4 : 1,
            }}
          >
            <span
              style={{
                width: 10, height: 10, borderRadius: cls === 'event' ? 1 : 2,
                border: `2px solid ${CLASS_COLOR_FALLBACK[cls]}`, background: `${CLASS_COLOR_FALLBACK[cls]}22`,
                display: 'inline-block', textDecoration: isHidden ? 'line-through' : 'none',
              }}
            />
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)', textDecoration: isHidden ? 'line-through' : 'none' }}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function SagaDiagram({ service }: SagaDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [actions, setActions] = useState<Action[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState<Hidden>({});

  useEffect(() => {
    let cancelled = false;
    if (!service) {
      setActions([]);
      setEvents([]);
      return;
    }
    setLoading(true);
    Promise.all([actionsApi.getForPackage(service), eventsApi.getAll(service)])
      .then(([a, e]) => {
        if (cancelled) return;
        setActions(a);
        setEvents(e);
      })
      .catch(() => {
        if (cancelled) return;
        setActions([]);
        setEvents([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [service]);

  const graph = useMemo(() => actionsToSagaGraph(actions, events), [actions, events]);
  const elements = useMemo(() => sagaGraphToElements(graph, hidden), [graph, hidden]);
  const stylesheet = useMemo(() => createSagaStylesheet(), []);

  const { cyRef, cy } = useCytoscapeInstance(containerRef, elements, stylesheet);
  const { runLayout } = useCytoscapeLayout(cyRef);

  // Apply the internal-dashed class + run the left-to-right layout when ready.
  useEffect(() => {
    if (!cy || cy.destroyed() || elements.length === 0) return;
    cy.nodes('[internal = 1]').addClass('internal-dashed');
    const timer = setTimeout(() => {
      if (!cy.destroyed()) runLayout('dagre', 'LR');
    }, 50);
    return () => clearTimeout(timer);
  }, [cy, elements, runLayout]);

  const toggle = useCallback(
    (c: 'command' | 'query' | 'unclassified') => setHidden((h) => ({ ...h, [c]: !h[c] })),
    [],
  );

  const isEmpty = !loading && elements.length === 0;

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {isEmpty && (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', fontStyle: 'italic', pointerEvents: 'none', textAlign: 'center', padding: 24,
          }}
        >
          {service
            ? 'No actions or events to graph in this package. Add actions with invoke/emit/wait steps to see the process map.'
            : 'Open a package to see its process / saga map.'}
        </div>
      )}
      {!isEmpty && <SagaLegend hidden={hidden} onToggle={toggle} />}
    </div>
  );
}
