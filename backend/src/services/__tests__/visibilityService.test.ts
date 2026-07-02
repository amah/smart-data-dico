/**
 * Visibility (hide) policy — explicit `system.hidden` flag, pin-visible override,
 * and glob/regex hide rules matched against entity name / physical table name.
 */
import type { Entity } from '../../models/EntitySchema.js';
import { compileHideRules, isEntityHidden, entityHidden, filterHiddenEntities, isPackageHidden } from '../visibilityService.js';
import type { HideRule } from '../dicoConfigService.js';

const ent = (name: string, meta: Array<{ name: string; value: string }> = []): Entity =>
  ({ name, attributes: [], metadata: meta } as unknown as Entity);

const compiled = (rules: HideRule[]) => compileHideRules(rules);

describe('explicit flag', () => {
  it('hides an entity flagged system.hidden=true', () => {
    expect(isEntityHidden(ent('Order', [{ name: 'system.hidden', value: 'true' }]), [])).toBe(true);
  });
  it('does not hide a normal entity', () => {
    expect(isEntityHidden(ent('Order'), [])).toBe(false);
  });
  it('carries the hidden reason', () => {
    const r = entityHidden(ent('Bak', [{ name: 'system.hidden', value: 'true' }, { name: 'system.hiddenReason', value: 'backup' }]), []);
    expect(r).toEqual({ hidden: true, reason: 'backup' });
  });
});

describe('glob rules', () => {
  const rules = compiled([{ match: 'physicalTableName', pattern: '*_bak' }, { match: 'entityName', pattern: 'Tmp*' }]);
  it('hides by physical table-name glob', () => {
    expect(isEntityHidden(ent('Order', [{ name: 'physical.tableName', value: 'orders_bak' }]), rules)).toBe(true);
  });
  it('hides by entity-name glob', () => {
    expect(isEntityHidden(ent('TmpStaging'), rules)).toBe(true);
  });
  it('leaves non-matching entities visible', () => {
    expect(isEntityHidden(ent('Order', [{ name: 'physical.tableName', value: 'orders' }]), rules)).toBe(false);
  });
  it('is case-insensitive', () => {
    expect(isEntityHidden(ent('X', [{ name: 'physical.tableName', value: 'ORDERS_BAK' }]), rules)).toBe(true);
  });
});

describe('regex rules', () => {
  const rules = compiled([{ match: 'physicalTableName', pattern: '_[0-9]{8}$', regex: true }]);
  it('hides a dated-snapshot table', () => {
    expect(isEntityHidden(ent('Snap', [{ name: 'physical.tableName', value: 'orders_20240101' }]), rules)).toBe(true);
  });
  it('ignores a non-dated table', () => {
    expect(isEntityHidden(ent('Order', [{ name: 'physical.tableName', value: 'orders' }]), rules)).toBe(false);
  });
});

describe('pin-visible override', () => {
  it('system.hidden=false keeps an entity visible even when a rule matches', () => {
    const rules = compiled([{ match: 'physicalTableName', pattern: '*_bak' }]);
    const e = ent('Keep', [{ name: 'physical.tableName', value: 'keep_bak' }, { name: 'system.hidden', value: 'false' }]);
    expect(isEntityHidden(e, rules)).toBe(false);
  });
});

describe('filterHiddenEntities', () => {
  const rules = compiled([{ match: 'physicalTableName', pattern: '*_bak' }]);
  const list = [
    ent('Order', [{ name: 'physical.tableName', value: 'orders' }]),
    ent('OrderBak', [{ name: 'physical.tableName', value: 'orders_bak' }]),
    ent('Hidden', [{ name: 'system.hidden', value: 'true' }]),
  ];
  it('drops hidden by default', () => {
    expect(filterHiddenEntities(list, rules, false).map((e) => e.name)).toEqual(['Order']);
  });
  it('keeps everything when includeHidden', () => {
    expect(filterHiddenEntities(list, rules, true)).toHaveLength(3);
  });
});

describe('package rules', () => {
  it('matches a packageName rule', () => {
    const rules = compiled([{ match: 'packageName', pattern: 'legacy-*' }]);
    expect(isPackageHidden('legacy-billing', rules)).toBe(true);
    expect(isPackageHidden('orders', rules)).toBe(false);
  });
});

describe('compileHideRules', () => {
  it('skips a rule with an invalid regex rather than throwing', () => {
    const rules = compileHideRules([{ match: 'entityName', pattern: '(', regex: true }, { match: 'entityName', pattern: 'X*' }]);
    expect(rules).toHaveLength(1);
  });
});
