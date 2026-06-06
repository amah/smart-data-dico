/**
 * viewElementBuilders.test.ts (#183)
 *
 * Foundation guarantees for the mode-aware element builder:
 *   1. `structural` output is byte-for-byte the legacy mapGraphDataToCytoscape
 *      output (deep-equality + a snapshot to catch any drift).
 *   2. The dispatch selects a builder per `viewMode`; logical/physical are
 *      wired and callable. (Their mode-specific behaviour is covered by the
 *      logical/physical builder tests in #184–#187.)
 */
import { describe, it, expect } from 'vitest';
import type { GraphNode, GraphEdge } from '../../../types';
import { AttributeType } from '../../../types';
import { mapGraphDataToCytoscape } from '../mapGraphDataToCytoscape';
import { buildViewElements } from '../viewElementBuilders';
import { VIEW_MODES } from '../viewMode';

const NODES: GraphNode[] = [
  {
    id: 'order-uuid',
    label: 'Order',
    type: 'entity',
    service: 'order-service',
    data: {
      uuid: 'order-uuid',
      name: 'Order',
      description: 'A customer order',
      attributes: [
        { uuid: 'a1', name: 'id', description: '', type: AttributeType.STRING, required: true, primaryKey: true },
        { uuid: 'a2', name: 'total', description: '', type: AttributeType.NUMBER, required: true },
      ],
    },
  },
  {
    id: 'item-uuid',
    label: 'OrderItem',
    type: 'entity',
    service: 'order-service',
    data: {
      uuid: 'item-uuid',
      name: 'OrderItem',
      description: '',
      attributes: [{ uuid: 'b1', name: 'qty', description: '', type: AttributeType.NUMBER, required: true }],
    },
  },
];

const EDGES: GraphEdge[] = [
  {
    id: 'rel-1',
    source: 'order-uuid',
    target: 'item-uuid',
    label: 'Order has items',
    sourceCardinality: 'one',
    targetCardinality: 'many',
    sourceName: 'items',
    targetName: 'order',
    metadata: [{ name: 'orm.fetch', value: 'LAZY' }],
  },
];

const PARENT_MAPPING = { 'order-uuid': 'pkg:order-service', 'item-uuid': 'pkg:order-service' };

describe('buildViewElements', () => {
  it('structural output equals the legacy mapGraphDataToCytoscape output', () => {
    const legacy = mapGraphDataToCytoscape(NODES, EDGES, PARENT_MAPPING);
    const viaBuilder = buildViewElements('structural', NODES, EDGES, PARENT_MAPPING);
    expect(viaBuilder).toEqual(legacy);
  });

  it('structural output is snapshot-stable', () => {
    expect(buildViewElements('structural', NODES, EDGES, PARENT_MAPPING)).toMatchSnapshot();
  });

  it('every view mode is wired and returns elements', () => {
    for (const mode of VIEW_MODES) {
      const els = buildViewElements(mode, NODES, EDGES, PARENT_MAPPING);
      expect(Array.isArray(els)).toBe(true);
      // two entity nodes in every mode (compact node-per-entity)
      expect(els.filter((e) => e.group === 'nodes').length).toBeGreaterThanOrEqual(2);
    }
  });
});
