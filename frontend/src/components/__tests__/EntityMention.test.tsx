/**
 * #60 — Inline entity preview cards in chat.
 *
 * Two layers:
 *   1. processMentions: pure function that walks a ReactNode tree and
 *      replaces `@Name` substrings with <EntityMention/>. Pure-fn
 *      coverage.
 *   2. <EntityMention/>: hover→fetch→preview-card flow, with the
 *      module-level cache reset between tests so adjacent specs
 *      don't share state.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/setup';
import EntityMention, {
  processMentions,
  __resetEntityMentionCache,
} from '../EntityMention';

beforeEach(() => {
  __resetEntityMentionCache();
});

describe('processMentions', () => {
  it('returns plain text when no @-tokens are present', () => {
    expect(processMentions('hello world')).toBe('hello world');
  });

  it('splits a single @-token into a mention component', () => {
    const out = processMentions('see @Order for details');
    expect(Array.isArray(out)).toBe(true);
    const arr = out as unknown[];
    // text before, mention, text after
    expect(arr).toHaveLength(3);
    expect(arr[0]).toBe('see ');
    expect(arr[2]).toBe(' for details');
  });

  it('handles multiple mentions in the same string', () => {
    const out = processMentions('@Order links to @Customer');
    const arr = out as unknown[];
    // mention, ' links to ', mention
    expect(arr).toHaveLength(3);
    expect(arr[1]).toBe(' links to ');
  });

  it('walks into nested elements', () => {
    const tree = (
      <div>
        <strong>see @Order here</strong>
      </div>
    );
    const { container } = render(<MemoryRouter>{processMentions(tree) as React.ReactElement}</MemoryRouter>);
    expect(container.querySelector('[data-testid^="entity-mention"]')).not.toBeNull();
  });

  it('does not match @ followed by non-letter (e.g. @123 or @ space)', () => {
    expect(processMentions('email me @ work')).toBe('email me @ work');
    expect(processMentions('cost was @5')).toBe('cost was @5');
  });
});

describe('<EntityMention/>', () => {
  let restoreFetch: () => void = () => {};

  afterEach(() => {
    restoreFetch();
  });

  it('renders an unknown mention as plain text after resolution fails to find it', async () => {
    server.use(
      http.get('/api/ai/mentions/search', () =>
        HttpResponse.json({ data: { entities: [], packages: [] } }),
      ),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EntityMention name="Nonexistent" />
      </MemoryRouter>,
    );
    // Initially renders as the active link (we don't know yet).
    const link = screen.getByTestId('entity-mention');
    await user.hover(link);
    // After mention search returns no matches, we re-render as plain text.
    await waitFor(() => {
      expect(screen.getByTestId('entity-mention-unknown')).toBeInTheDocument();
    });
  });

  it('shows a preview card on hover when the entity resolves', async () => {
    server.use(
      http.get('/api/ai/mentions/search', () =>
        HttpResponse.json({
          data: {
            entities: [{ name: 'Order', packageName: 'order-service' }],
            packages: [],
          },
        }),
      ),
      http.get('/api/services/order-service/entities/Order', () =>
        HttpResponse.json({
          data: {
            name: 'Order',
            microservice: 'order-service',
            stereotype: 'aggregate-root',
            status: 'approved',
            attributes: [
              { name: 'id', type: 'string' },
              { name: 'total', type: 'number' },
              { name: 'placedAt', type: 'date' },
            ],
          },
        }),
      ),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EntityMention name="Order" />
      </MemoryRouter>,
    );
    const link = screen.getByTestId('entity-mention');
    await user.hover(link);

    const card = await screen.findByTestId('entity-mention-card');
    expect(card).toHaveTextContent('Order');
    expect(card).toHaveTextContent('order-service');
    expect(card).toHaveTextContent('3 attributes');
    expect(card).toHaveTextContent('aggregate-root');
    expect(card).toHaveTextContent('approved');
  });

  it('caches resolved entities — second mention with the same name does not re-fetch', async () => {
    let searchCalls = 0;
    let detailCalls = 0;
    server.use(
      http.get('/api/ai/mentions/search', () => {
        searchCalls += 1;
        return HttpResponse.json({
          data: {
            entities: [{ name: 'Order', packageName: 'order-service' }],
            packages: [],
          },
        });
      }),
      http.get('/api/services/order-service/entities/Order', () => {
        detailCalls += 1;
        return HttpResponse.json({
          data: { name: 'Order', microservice: 'order-service', attributes: [] },
        });
      }),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EntityMention name="Order" />
        <EntityMention name="Order" />
      </MemoryRouter>,
    );

    const links = screen.getAllByTestId('entity-mention');
    await user.hover(links[0]);
    await waitFor(() => expect(searchCalls).toBe(1));
    await waitFor(() => expect(detailCalls).toBe(1));

    await user.hover(links[1]);
    // Second hover should NOT trigger another fetch; allow async tasks
    // to flush before asserting.
    await act(async () => {
      await new Promise(r => setTimeout(r, 20));
    });
    expect(searchCalls).toBe(1);
    expect(detailCalls).toBe(1);
  });
});
