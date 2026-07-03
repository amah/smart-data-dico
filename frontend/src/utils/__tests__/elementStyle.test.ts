/**
 * Element Style resolver — precedence (override → rule → detected role →
 * stereotype → none) and the zero-tagging role detectors.
 */
import { describe, it, expect } from 'vitest';
import { detectRole, compileStyleRules, resolveElementStyle, type ElementStyle, type StyleRule } from '../elementStyle';

const STYLES: ElementStyle[] = [
  { name: 'aggregate-root', border: 'primary', emphasis: true },
  { name: 'junction', shape: 'hexagon' },
  { name: 'reference' },
  { name: 'remote-ref' },
];
const el = (name: string, meta: Array<{ name: string; value: string }> = [], stereotype?: string) => ({ name, metadata: meta, stereotype });
const resolve = (element: Parameters<typeof resolveElementStyle>[0], signals: Parameters<typeof resolveElementStyle>[1], rules: StyleRule[] = []) =>
  resolveElementStyle(element, signals, STYLES, compileStyleRules(rules));

describe('detectRole', () => {
  it('remote wins over everything', () => expect(detectRole({ remote: true, isJunction: true })).toBe('remote-ref'));
  it('junction next', () => expect(detectRole({ isJunction: true })).toBe('junction'));
  it('FK-target-only → reference', () => expect(detectRole({ fkInDegree: 3, fkOutDegree: 0 })).toBe('reference'));
  it('a table with outgoing FKs is not a reference', () => expect(detectRole({ fkInDegree: 3, fkOutDegree: 2 })).toBeUndefined());
  it('no signals → undefined', () => expect(detectRole(undefined)).toBeUndefined());
});

describe('resolveElementStyle precedence', () => {
  it('explicit system.style override wins', () => {
    const r = resolve(el('Order', [{ name: 'system.style', value: 'aggregate-root' }]), { isJunction: true });
    expect(r.styleName).toBe('aggregate-root'); // beats the junction signal
  });
  it('ignores an override that names an unknown style', () => {
    const r = resolve(el('Order', [{ name: 'system.style', value: 'ghost' }]), { isJunction: true });
    expect(r.styleName).toBe('junction'); // falls through to the detected role
  });
  it('a style rule (by stereotype) applies', () => {
    const rules: StyleRule[] = [{ match: 'stereotype', pattern: 'aggregate-root', style: 'aggregate-root' }];
    expect(resolve(el('Order', [], 'aggregate-root'), undefined, rules).styleName).toBe('aggregate-root');
  });
  it('a style rule (by physical table-name glob) applies', () => {
    const rules: StyleRule[] = [{ match: 'physicalTableName', pattern: '*_link', style: 'junction' }];
    expect(resolve(el('OrderItem', [{ name: 'physical.tableName', value: 'order_item_link' }]), undefined, rules).styleName).toBe('junction');
  });
  it('detected role maps to the same-named style', () => {
    expect(resolve(el('OrderLine'), { isJunction: true }).styleName).toBe('junction');
    expect(resolve(el('Country'), { fkInDegree: 5, fkOutDegree: 0 }).styleName).toBe('reference');
  });
  it('stereotype maps to a same-named style with no rule', () => {
    expect(resolve(el('Order', [], 'aggregate-root'), undefined).styleName).toBe('aggregate-root');
  });
  it('returns just the role (no styleName) when nothing matches', () => {
    const r = resolve(el('Plain'), { fkInDegree: 1, fkOutDegree: 1 });
    expect(r.styleName).toBeUndefined();
    expect(r.role).toBeUndefined();
  });
  it('carries the resolved style object', () => {
    expect(resolve(el('X'), { isJunction: true }).style?.shape).toBe('hexagon');
  });
});

describe('compileStyleRules', () => {
  it('skips a rule with an invalid regex', () => {
    expect(compileStyleRules([{ match: 'entityName', pattern: '(', regex: true, style: 'junction' }, { match: 'role', pattern: 'junction', style: 'junction' }])).toHaveLength(1);
  });
});
