/**
 * Element Style diagram wiring — the post-process that stamps `styleName` onto
 * nodes (from override / rule / detected role / stereotype), and the stylesheet
 * selector generator.
 */
import { describe, it, expect } from 'vitest';
import type { ElementDefinition } from 'cytoscape';
import type { GraphNode } from '../../../types';
import { applyElementStyles } from '../applyElementStyles';
import { buildElementStyleSelectors } from '../cytoscapeStylesheet';
import { compileStyleRules, type ElementStyle, type StyleRule } from '../../../utils/elementStyle';

const STYLES: ElementStyle[] = [
  { name: 'aggregate-root', border: '#6366F1', emphasis: true },
  { name: 'junction', shape: 'hexagon' },
  { name: 'reference' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gnode = (id: string, entity: any): GraphNode => ({ id, label: entity.name, service: 'svc', data: entity } as any);
const node = (id: string, type = 'entity'): ElementDefinition => ({ group: 'nodes', data: { id, type, label: id } });
const fk = (source: string, target: string): ElementDefinition => ({ group: 'edges', data: { id: `${source}->${target}`, source, target, edgeKind: 'fk' } });

describe('applyElementStyles', () => {
  it('stamps a style from the stereotype (same-named style)', () => {
    const nodes = [gnode('a', { name: 'Order', stereotype: 'aggregate-root' })];
    const els = applyElementStyles([node('a')], nodes, STYLES, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((els[0].data as any).styleName).toBe('aggregate-root');
  });

  it('detects a junction (jointable) node', () => {
    const nodes = [gnode('j', { name: 'OrderTag' })];
    const els = applyElementStyles([node('j', 'jointable')], nodes, STYLES, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((els[0].data as any).styleName).toBe('junction');
  });

  it('detects an FK-target-only reference from the fk edges', () => {
    const nodes = [gnode('country', { name: 'Country' }), gnode('addr', { name: 'Address' })];
    // Address → Country (Country is a target only) ⇒ Country = reference.
    const els = applyElementStyles([node('country'), node('addr'), fk('addr', 'country')], nodes, STYLES, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = Object.fromEntries(els.filter(e => e.group === 'nodes').map(e => [(e.data as any).id, (e.data as any).styleName]));
    expect(byId.country).toBe('reference');
    expect(byId.addr).toBeUndefined(); // has an outgoing FK → not a reference
  });

  it('honours an explicit system.style override', () => {
    const nodes = [gnode('a', { name: 'X', metadata: [{ name: 'system.style', value: 'aggregate-root' }] })];
    const els = applyElementStyles([node('a', 'jointable')], nodes, STYLES, []); // jointable, but override wins
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((els[0].data as any).styleName).toBe('aggregate-root');
  });

  it('applies a style rule (by entity-name glob)', () => {
    const rules = compileStyleRules([{ match: 'entityName', pattern: 'Legacy*', style: 'reference' } as StyleRule]);
    const nodes = [gnode('a', { name: 'LegacyOrder' })];
    const els = applyElementStyles([node('a')], nodes, STYLES, rules);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((els[0].data as any).styleName).toBe('reference');
  });

  it('is a no-op when no styles are defined', () => {
    const nodes = [gnode('a', { name: 'Order', stereotype: 'aggregate-root' })];
    const els = applyElementStyles([node('a')], nodes, [], []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((els[0].data as any).styleName).toBeUndefined();
  });
});

describe('buildElementStyleSelectors', () => {
  it('emits one node[styleName] selector per style with mapped props', () => {
    const sheets = buildElementStyleSelectors(
      [{ name: 'aggregate-root', fill: '#eef', border: '#333', borderWidth: 4, borderStyle: 'dashed', shape: 'hexagon', opacity: 0.8, emphasis: true }],
      '#570df8',
    );
    expect(sheets).toHaveLength(1);
    expect(sheets[0].selector).toBe('node[styleName = "aggregate-root"]');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = sheets[0].style as any;
    expect(s['background-color']).toBe('#eef');
    expect(s['border-color']).toBe('#333');
    expect(s['border-width']).toBe(4);
    expect(s['border-style']).toBe('dashed');
    expect(s.shape).toBe('hexagon');
    expect(s.opacity).toBe(0.8);
    expect(s['z-index']).toBe(20); // emphasis
  });
});
