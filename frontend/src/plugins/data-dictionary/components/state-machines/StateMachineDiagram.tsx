/**
 * StateMachineDiagram — read-only Cytoscape diagram for a single state machine (#179).
 *
 * Layout: dagre (top-to-bottom).
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

interface StateMachineDiagramProps {
  sm: StateMachine;
  height?: number;
}

export function StateMachineDiagram({ sm, height = 320 }: StateMachineDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    ensureDagre();

    const stateNames = new Set(sm.states.map(s => s.name));
    const initialState = sm.initialState;

    // Build elements
    const elements: cytoscape.ElementDefinition[] = [];

    // Nodes (states)
    for (const s of sm.states) {
      elements.push({
        data: {
          id: s.name,
          label: s.name,
          isInitial: s.name === initialState,
          isTerminal: !!s.terminal,
        },
      });
    }

    // Edges (transitions)
    for (const t of sm.transitions) {
      // Wildcard "from" — add an edge from every non-terminal state
      const sources = t.from === '*'
        ? sm.states.filter(s => !s.terminal).map(s => s.name)
        : [t.from];

      for (const src of sources) {
        if (!stateNames.has(src) || !stateNames.has(t.to)) continue;
        const guardLabel = t.guard ? ` [${t.guard}]` : '';
        elements.push({
          data: {
            id: `${t.uuid}-${src}`,
            source: src,
            target: t.to,
            label: t.on + guardLabel,
          },
        });
      }
    }

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
            'font-size': 11,
            'font-family': 'var(--font-mono, monospace)',
            width: 'label',
            height: 'label',
            padding: 10,
            shape: 'round-rectangle',
            'background-color': 'var(--bg-raised, #fff)',
            'border-width': 1,
            'border-color': 'var(--border, #ddd)',
            color: 'var(--text, #111)',
          },
        },
        {
          selector: 'node[?isInitial]',
          style: {
            'background-color': 'var(--accent, #4f46e5)',
            color: '#fff',
            'font-weight': 700,
          },
        },
        {
          selector: 'node[?isTerminal]',
          style: {
            'border-width': 3,
            'border-color': 'var(--border-strong, #666)',
            'border-style': 'double',
          },
        },
        {
          selector: 'edge',
          style: {
            label: 'data(label)',
            'font-size': 9,
            'font-family': 'var(--font-sans, sans-serif)',
            color: 'var(--text-subtle, #666)',
            'text-background-color': 'var(--bg-raised, #fff)',
            'text-background-opacity': 1,
            'text-background-padding': 2,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8,
            'line-color': 'var(--border, #ddd)',
            'target-arrow-color': 'var(--border, #ddd)',
            width: 1.5,
          },
        },
      ],
      layout: {
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 40,
        rankSep: 60,
        padding: 20,
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
