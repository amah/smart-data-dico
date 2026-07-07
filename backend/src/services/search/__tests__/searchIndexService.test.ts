/**
 * searchIndexService.packageOfEvent — maps a projection invalidation event to
 * the owning top-level package (or null → full rebuild). Pure, no SQLite.
 */
import { packageOfEvent } from '../searchIndexService.js';
import type { LogicalPath } from '../../../storage/projection/LogicalProjection.js';

const lp = (s: string) => s as LogicalPath;

describe('packageOfEvent', () => {
  it('resolves entity write/delete from the logical path', () => {
    expect(packageOfEvent({ kind: 'entity-written', logicalPath: lp('packages/ordering/entities/Order'), uuid: 'u' })).toBe('ordering');
    expect(packageOfEvent({ kind: 'entity-deleted', logicalPath: lp('packages/catalog/entities/Product') })).toBe('catalog');
  });

  it('resolves relationships and package/case-scoped rules', () => {
    expect(packageOfEvent({ kind: 'relationships-written', packagePath: lp('packages/ordering'), uuids: [] })).toBe('ordering');
    expect(packageOfEvent({ kind: 'rule-written', scope: 'package', ruleUuid: 'r', anchorLogicalPath: lp('packages/billing/entities/Invoice') })).toBe('billing');
  });

  it('resolves case events and raw-changed physical paths', () => {
    expect(packageOfEvent({ kind: 'case-written', logicalPath: lp('packages/ordering/cases/Checkout'), uuid: 'c' })).toBe('ordering');
    expect(packageOfEvent({ kind: 'raw-changed', physicalPath: 'ordering/Order.model.yaml', changeKind: 'change' })).toBe('ordering');
  });

  it('returns null (→ full rebuild) for global rules, root files and reserved dirs', () => {
    expect(packageOfEvent({ kind: 'rule-written', scope: 'global', ruleUuid: 'r' })).toBeNull();
    expect(packageOfEvent({ kind: 'rule-deleted', scope: 'package', ruleUuid: 'r' })).toBeNull();
    expect(packageOfEvent({ kind: 'raw-changed', physicalPath: 'rules.yaml', changeKind: 'change' })).toBeNull();
    expect(packageOfEvent({ kind: 'raw-changed', physicalPath: '.dico/schemas/pii.entity.yaml', changeKind: 'change' })).toBeNull();
  });
});
