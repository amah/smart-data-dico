import { describe, expect, it } from 'vitest';
import { rankSpotlightHits, type SpotlightHit } from '../SpotlightSearch';

const hit = (name: string, extra: Partial<SpotlightHit> = {}): SpotlightHit => ({
  id: extra.id ?? name,
  kind: extra.kind ?? 'entity',
  name,
  service: extra.service ?? 'ordering',
  route: extra.route ?? `/packages/ordering/entities/${name}`,
  ...extra,
});

describe('rankSpotlightHits', () => {
  it('promotes an exact name above prefix and incidental matches', () => {
    const ranked = rankSpotlightHits([
      hit('OrderHistory'),
      hit('customerId', { entityName: 'Order' }),
      hit('Order'),
      hit('PreOrder'),
    ], 'order');

    expect(ranked.map(result => result.name)).toEqual([
      'Order',
      'OrderHistory',
      'customerId',
      'PreOrder',
    ]);
  });

  it('matches labels case-insensitively across camel-case, spaces, and punctuation', () => {
    const ranked = rankSpotlightHits([
      hit('OrderHistory'),
      hit('OrderItem'),
    ], 'order item');

    expect(ranked[0].name).toBe('OrderItem');
  });

  it('preserves the backend relevance order for equally strong matches', () => {
    const ranked = rankSpotlightHits([
      hit('OrderLine'),
      hit('OrderLedger'),
    ], 'order');

    expect(ranked.map(result => result.name)).toEqual(['OrderLine', 'OrderLedger']);
  });
});
