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
  { name: 'aggregate-root', border: '#6366F1', emphasis: true, badge: 'AR' },
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

  it('renders a style badge as a «tag» line on the node label', () => {
    const nodes = [gnode('a', { name: 'Order', stereotype: 'aggregate-root' })];
    const els = applyElementStyles([{ group: 'nodes', data: { id: 'a', type: 'entity', label: 'Order', displayLabel: 'Order' } }], nodes, STYLES, []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = els[0].data as any;
    expect(d.styleBadge).toBe('AR');
    expect(d.displayLabel).toBe('Order\n«AR»');
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

  it('grades emphasis levels: border weight + fill gating + z-order', () => {
    const [none, l1, l2, l3] = buildElementStyleSelectors([
      { name: 'none', fill: '#eef' },
      { name: 'light', fill: '#eef', emphasis: 1 },
      { name: 'medium', fill: '#eef', emphasis: 2 },
      { name: 'strong', fill: '#eef', emphasis: 3 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).map((sh) => sh.style as any);

    expect(none['z-index']).toBeUndefined();
    expect(none['background-color']).toBe('#eef');            // no emphasis → fill shows

    expect(l1['z-index']).toBe(20);
    expect(l1['border-width']).toBe(2);                       // light → thin border
    expect(l1['background-color']).toBeUndefined();           // levels 1–2 suppress the fill

    expect(l2['border-width']).toBe(4);                       // medium → thick border
    expect(l2['background-color']).toBeUndefined();           // still no fill (current w/o fill)

    expect(l3['border-width']).toBe(4);                       // strong → thick border
    expect(l3['background-color']).toBe('#eef');              // only level 3 shows the fill
  });

  it('ramps a greyscale font by emphasis level (base readable → top darkest)', () => {
    const [none, l1, l2, l3, explicit] = buildElementStyleSelectors([
      { name: 'none' },
      { name: 'l1', emphasis: 1 },
      { name: 'l2', emphasis: 2 },
      { name: 'l3', emphasis: 3 },
      { name: 'x', emphasis: 3, textColor: '#ff0000' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).map((sh) => sh.style as any);
    // No explicit textColor → base-content colour + a text-opacity that rises with level.
    expect(none['text-opacity']).toBe(0.75);   // base, still well visible
    expect(l1['text-opacity']).toBe(0.83);
    expect(l2['text-opacity']).toBe(0.92);
    expect(l3['text-opacity']).toBe(1);        // top, darkest
    expect(none['color']).toBeTruthy();
    // Explicit textColor wins and skips the ramp.
    expect(explicit['color']).toBe('#ff0000');
    expect(explicit['text-opacity']).toBeUndefined();
  });

  it('treats emphasis:true as level 3 (legacy) and lets explicit borderWidth win', () => {
    const [legacy, pinned] = buildElementStyleSelectors([
      { name: 'legacy', fill: '#eef', emphasis: true },
      { name: 'pinned', emphasis: 1, borderWidth: 6 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]).map((sh) => sh.style as any);
    expect(legacy['border-width']).toBe(4);
    expect(legacy['background-color']).toBe('#eef');          // true == strong → fill shows
    expect(pinned['border-width']).toBe(6);                   // explicit borderWidth overrides the level
  });
});
