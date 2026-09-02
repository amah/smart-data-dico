/**
 * StateMachineDiagram — read-only Cytoscape diagram for a single state machine (#179).
 *
 * Layout: dagre (left-to-right, matching the wide entity-detail card).
 * States are nodes; transitions are edges labeled with their event + guard.
 * Initial state has a distinct background. Terminal states are rendered with
 * a double border (simulated with a shadow).
 */

import { useRef, useEffect } from 'react';
import type { StateMachine } from '../../../../types';

// Cytoscape and dagre are already bundled — import the same way as useCytoscapeInstance.ts
import cytoscape from 'cytoscape';
// @ts-expect-error — no types for cytoscape-dagre
import dagre from 'cytoscape-dagre';

let dagreRegistered = false;
function ensureDagre() {
  if (dagreRegistered) return;
  cytoscape.use(dagre);
  dagreRegistered = true;
}

/** Cytoscape paints to canvas and cannot resolve CSS custom properties. */
function resolveCssColor(token: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (!value) return fallback;

  try {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return fallback;
    context.fillStyle = '#123456';
    context.fillStyle = value;
    if (context.fillStyle !== '#123456') return context.fillStyle;

    // DaisyUI may expose a bare HSL triplet rather than a complete colour.
    context.fillStyle = `hsl(${value})`;
    return context.fillStyle !== '#123456' ? context.fillStyle : fallback;
  } catch {
    return fallback;
  }
}

interface StateMachineDiagramProps {
  sm: StateMachine;
  height?: number;
}

/** Build the graph independently of the canvas so expansion rules stay testable. */
export function stateMachineToElements(sm: StateMachine): cytoscape.ElementDefinition[] {
  const stateNames = new Set(sm.states.map(s => s.name));
  const elements: cytoscape.ElementDefinition[] = sm.states.map((state) => ({
    data: {
      id: state.name,
      label: state.name,
      isInitial: state.name === sm.initialState,
      isTerminal: !!state.terminal,
    },
  }));

  for (const transition of sm.transitions) {
    const sources = transition.from === '*'
      ? sm.states.filter(state => !state.terminal).map(state => state.name)
      : [transition.from];
    const guardLabel = transition.guard ? ` [${transition.guard}]` : '';

    sources.forEach((source, index) => {
      if (!stateNames.has(source) || !stateNames.has(transition.to)) return;
      elements.push({
        data: {
          id: `${transition.uuid}-${source}`,
          source,
          target: transition.to,
          // A wildcard expands to several edges. Repeating its long label on
          // every edge obscures the graph, so label the first representative;
          // the transition table below retains the complete declaration.
          label: transition.from !== '*' || index === 0
            ? transition.on + guardLabel
            : '',
        },
      });
    });
  }

  return elements;
}

export function StateMachineDiagram({ sm, height = 320 }: StateMachineDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    ensureDagre();

    const colors = {
      raised: resolveCssColor('--bg-raised', '#ffffff'),
      border: resolveCssColor('--border', '#d1d5db'),
      borderStrong: resolveCssColor('--border-strong', '#6b7280'),
      text: resolveCssColor('--text', '#111827'),
      textSubtle: resolveCssColor('--text-subtle', '#4b5563'),
      accent: resolveCssColor('--accent', '#4f46e5'),
    };

    const elements = stateMachineToElements(sm);

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '140px',
            'font-size': 11,
            'font-family': 'var(--font-mono, monospace)',
            width: 'label',
            height: 'label',
            padding: 10,
            shape: 'round-rectangle',
            'background-color': colors.raised,
            'border-width': 1,
            'border-color': colors.border,
            color: colors.text,
          },
        },
        {
          selector: 'node[?isInitial]',
          style: {
            'background-color': colors.accent,
            color: '#fff',
            'font-weight': 700,
          },
        },
        {
          selector: 'node[?isTerminal]',
          style: {
            'border-width': 3,
            'border-color': colors.borderStrong,
            'border-style': 'double',
          },
        },
        {
          selector: 'edge',
          style: {
            label: 'data(label)',
            'font-size': 9,
            'font-family': 'var(--font-sans, sans-serif)',
            color: colors.textSubtle,
            'text-background-color': colors.raised,
            'text-background-opacity': 1,
            'text-background-padding': 3,
            'text-background-shape': 'roundrectangle',
            'text-margin-y': -9,
            'text-wrap': 'wrap',
            'text-max-width': '130px',
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
            'line-color': colors.borderStrong,
            'target-arrow-color': colors.borderStrong,
            width: 1.5,
          },
        },
      ],
      layout: {
        name: 'dagre',
        rankDir: 'LR',
        nodeSep: 36,
        rankSep: 132,
        edgeSep: 24,
        padding: 28,
        nodeDimensionsIncludeLabels: true,
      } as cytoscape.LayoutOptions,
      minZoom: 0.3,
      maxZoom: 3,
      wheelSensitivity: 0.3,
    });

    // Cleanup
    return () => {
      cy.destroy();
    };
  }, [sm]);

  if (sm.states.length === 0) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-sm)',
          fontStyle: 'italic',
          border: '1px dashed var(--border)',
          borderRadius: 6,
        }}
      >
        No states defined
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        height,
        border: '1px solid var(--border)',
        borderRadius: 6,
        background: 'var(--bg)',
      }}
    />
  );
}
