/**
 * PerspectiveTreeTable tests. Covers:
 *
 *   - The original "only root entities" regression: non-root hops are
 *     nested under their parent, not rendered as siblings at indent 0.
 *     (The backend emits paths as `<root>/<nav1>/<nav2>/…`, one nav per
 *     hop — an earlier version of this component stripped *two* trailing
 *     segments on parent lookup, which broke nesting entirely.)
 *
 *   - The inline nav prefix (`navName (1..*) → EntityName`) on non-root
 *     entity rows, and its absence on roots.
 *
 *   - Attribute expansion: clicking an entity reveals its ResolvedAttribute
 *     leaves, with type + PK/required markers.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PerspectiveTreeTable from '../PerspectiveTreeTable';
import type { ResolvedNode } from '../../types';
import { Cardinality } from '../../types';

const wrap = (ui: React.ReactElement) => <MemoryRouter>{ui}</MemoryRouter>;

const node = (overrides: Partial<ResolvedNode>): ResolvedNode => ({
  entityUuid: overrides.entityUuid || 'u',
  entityName: overrides.entityName || 'E',
  service: overrides.service || 'svc',
  path: overrides.path || 'E',
  hopDistance: overrides.hopDistance ?? 0,
  isRoot: overrides.isRoot ?? false,
  isFrontier: overrides.isFrontier ?? false,
  isManualInclusion: overrides.isManualInclusion ?? false,
  navName: overrides.navName,
  navCardinality: overrides.navCardinality,
  attributes: overrides.attributes,
});

describe('PerspectiveTreeTable — hierarchy', () => {
  it('nests hop-1 children under their hop-0 root (regression: not rendered as siblings)', () => {
    const nodes: ResolvedNode[] = [
      node({
        entityUuid: 'order',
        entityName: 'Order',
        path: 'Order',
        hopDistance: 0,
        isRoot: true,
      }),
      node({
        entityUuid: 'item',
        entityName: 'OrderItem',
        path: 'Order/items',
        hopDistance: 1,
        navName: 'items',
        navCardinality: { from: Cardinality.ONE, to: Cardinality.MANY },
      }),
      node({
        entityUuid: 'quote',
        entityName: 'Quote',
        path: 'Order/generatedFrom',
        hopDistance: 1,
        navName: 'generatedFrom',
        navCardinality: { from: Cardinality.ONE, to: Cardinality.ONE },
      }),
    ];

    render(wrap(<PerspectiveTreeTable nodes={nodes} />));

    expect(screen.getByRole('link', { name: 'Order' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OrderItem' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quote' })).toBeInTheDocument();

    // Non-root rows carry the inline nav prefix ("navName (card) →").
    const itemRow = screen.getByRole('link', { name: 'OrderItem' }).closest('tr')!;
    expect(within(itemRow).getByText('items')).toBeInTheDocument();
    expect(within(itemRow).getByText('(1..*)')).toBeInTheDocument();
    const quoteRow = screen.getByRole('link', { name: 'Quote' }).closest('tr')!;
    expect(within(quoteRow).getByText('generatedFrom')).toBeInTheDocument();
    expect(within(quoteRow).getByText('(1..1)')).toBeInTheDocument();

    // Root row has no nav prefix text.
    const orderRow = screen.getByRole('link', { name: 'Order' }).closest('tr')!;
    expect(orderRow.textContent).not.toMatch(/\(\d\.\.[\d*]\)/);
  });

  it('nests hop-2 nodes under their hop-1 parent via indent padding', () => {
    const nodes: ResolvedNode[] = [
      node({ entityUuid: 'u1', entityName: 'User', path: 'User', hopDistance: 0, isRoot: true }),
      node({
        entityUuid: 'o1',
        entityName: 'Order',
        path: 'User/orders',
        hopDistance: 1,
        navName: 'orders',
        navCardinality: { from: Cardinality.ONE, to: Cardinality.MANY },
      }),
      node({
        entityUuid: 'i1',
        entityName: 'OrderItem',
        path: 'User/orders/items',
        hopDistance: 2,
        navName: 'items',
        navCardinality: { from: Cardinality.ONE, to: Cardinality.MANY },
      }),
    ];

    render(wrap(<PerspectiveTreeTable nodes={nodes} />));

    const indent = (name: string) => {
      const link = screen.getByRole('link', { name });
      let el: HTMLElement | null = link;
      while (el && el.tagName !== 'TD') {
        const pad = el.getAttribute('style') || '';
        const m = /padding-left:\s*([0-9.]+)rem/.exec(pad);
        if (m) return parseFloat(m[1]);
        el = el.parentElement;
      }
      return 0;
    };
    // Tree indent is 0.75rem per hop (see PerspectiveTreeTable row renderer).
    expect(indent('User')).toBe(0);
    expect(indent('Order')).toBe(0.75);
    expect(indent('OrderItem')).toBe(1.5);
  });
});

describe('PerspectiveTreeTable — attribute expansion', () => {
  it('reveals attribute leaf rows when the entity is expanded', async () => {
    const nodes: ResolvedNode[] = [
      node({
        entityUuid: 'p1',
        entityName: 'Product',
        path: 'Product',
        hopDistance: 0,
        isRoot: true,
        attributes: [
          { name: 'id', type: 'uuid', required: true, primaryKey: true },
          { name: 'sku', type: 'string', required: true },
          { name: 'price', type: 'number', required: false },
        ],
      }),
    ];

    render(wrap(<PerspectiveTreeTable nodes={nodes} />));

    // Attributes are collapsed by default — only entity rows visible, no
    // `id` / `sku` / `price` cells yet. (A root entity with only attribute
    // children isn't auto-expanded; auto-expand only fires when the entity
    // has *entity* children.)
    expect(screen.queryByText('sku')).not.toBeInTheDocument();

    // Click the expand chevron on the Product row.
    const productRow = screen.getByRole('link', { name: 'Product' }).closest('tr')!;
    const chevron = within(productRow).getByRole('button', { name: /Expand/i });
    await userEvent.click(chevron);

    // Now all three attribute leaves are rendered.
    expect(screen.getByText('id')).toBeInTheDocument();
    expect(screen.getByText('sku')).toBeInTheDocument();
    expect(screen.getByText('price')).toBeInTheDocument();

    // PK badge on the id row, `required` on the sku row.
    const idRow = screen.getByText('id').closest('tr')!;
    expect(within(idRow).getByText('PK')).toBeInTheDocument();
    const skuRow = screen.getByText('sku').closest('tr')!;
    expect(within(skuRow).getByText('required')).toBeInTheDocument();
    // Type columns populate
    expect(within(idRow).getByText('uuid')).toBeInTheDocument();
    expect(within(skuRow).getByText('string')).toBeInTheDocument();
  });

  it('auto-expands entity parents; leaf entities start collapsed', () => {
    const nodes: ResolvedNode[] = [
      node({
        entityUuid: 'order',
        entityName: 'Order',
        path: 'Order',
        hopDistance: 0,
        isRoot: true,
        attributes: [{ name: 'id', type: 'uuid', required: true, primaryKey: true }],
      }),
      node({
        entityUuid: 'item',
        entityName: 'OrderItem',
        path: 'Order/OrderItem',
        hopDistance: 1,
        navName: 'items',
        navCardinality: { from: Cardinality.ONE, to: Cardinality.MANY },
        attributes: [{ name: 'quantity', type: 'integer', required: true }],
      }),
    ];

    render(wrap(<PerspectiveTreeTable nodes={nodes} />));

    // Order is auto-expanded (has entity children), so OrderItem + Order's
    // own attributes show. OrderItem is a leaf (no entity children) → not
    // auto-expanded, so its 'quantity' attribute is hidden.
    expect(screen.getByRole('link', { name: 'OrderItem' })).toBeInTheDocument();
    expect(screen.getByText('id')).toBeInTheDocument();
    expect(screen.queryByText('quantity')).not.toBeInTheDocument();
  });
});
