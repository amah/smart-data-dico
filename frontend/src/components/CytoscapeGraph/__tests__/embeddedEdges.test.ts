/**
 * embeddedEdges.test.ts (#embed)
 *
 * @Embedded attributes (orm.embedded + orm.javaType → an on-canvas embeddable)
 * yield a composition edge owner ◆— embeddable, one per embedded attribute.
 */
import { describe, it, expect } from 'vitest';
import type { GraphNode, Attribute } from '../../../types';
import { AttributeType } from '../../../types';
import { buildEmbeddedEdges } from '../embeddedEdges';

const embedAttr = (name: string, javaType?: string): Attribute => ({
  uuid: name,
  name,
  description: '',
  type: AttributeType.OBJECT,
  required: true,
  metadata: [
    { name: 'orm.embedded', value: true },
    ...(javaType ? [{ name: 'orm.javaType', value: javaType }] : []),
  ],
});

const node = (id: string, label: string, attributes: Attribute[] = []): GraphNode => ({
  id,
  label,
  type: 'entity',
  service: 'order-service',
  data: { uuid: id, name: label, description: '', attributes },
});

const ORDER = node('order', 'Order', [
  { uuid: 'id', name: 'id', description: '', type: AttributeType.STRING, required: true },
  embedAttr('shippingAddress', 'Address'),
  embedAttr('billingAddress', 'Address'),
]);
const ADDRESS = node('addr', 'Address');

describe('buildEmbeddedEdges', () => {
  it('emits one composition edge per @Embedded attribute, owner → embeddable', () => {
    const edges = buildEmbeddedEdges([ORDER, ADDRESS], 'logical');
    expect(edges).toHaveLength(2);
    for (const e of edges) {
      expect(e.data.source).toBe('order');
      expect(e.data.target).toBe('addr');
      expect(e.data.edgeType).toBe('composition');
      expect(e.data.sourceArrow).toBe('diamond'); // diamond at the owner (whole)
      expect(e.data.targetArrow).toBe('none');
    }
    expect(edges.map((e) => e.data.label).sort()).toEqual(['billingAddress', 'shippingAddress']);
  });

  it('drops embeds whose target embeddable is off-canvas', () => {
    expect(buildEmbeddedEdges([ORDER], 'logical')).toHaveLength(0); // no Address node
  });

  it('ignores non-embedded object attributes', () => {
    const plain = node('p', 'P', [
      { uuid: 'o', name: 'shape', description: '', type: AttributeType.OBJECT, required: true },
    ]);
    expect(buildEmbeddedEdges([plain, ADDRESS], 'structural')).toHaveLength(0);
  });
});
