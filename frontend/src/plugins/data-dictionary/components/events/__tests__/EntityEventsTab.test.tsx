/**
 * EntityEventsTab.test.tsx — #201 Phase 2 (first-class Events)
 *
 * Verifies the Events tab:
 *   1. Renders a row per event (name, payload count).
 *   2. Shows the empty state when there are no events.
 *   3. Opens the editor panel from the "New event" button.
 *   4. Creates an event via POST /api/events and invokes onEventsChanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../../../test/setup';
import type { Entity, Event } from '../../../../../types';
import { EntityEventsTab } from '../EntityEventsTab';

const ENTITY_UUID = '96a3ac78-d30b-4bf5-bb61-bf3174212f6c';

const makeEntity = (): Entity => ({
  uuid: ENTITY_UUID,
  name: 'Order',
  status: 'draft' as never,
  attributes: [],
});

const makeEvent = (overrides: Partial<Event> = {}): Event => ({
  uuid: 'evt-001',
  name: 'order.cancelled',
  ownerRef: ENTITY_UUID,
  description: 'Emitted on cancel',
  payload: [{ uuid: 'a', name: 'reason', type: 'string' } as never],
  ...overrides,
});

describe('EntityEventsTab', () => {
  const entity = makeEntity();
  const noop = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('renders a row per event with its payload count', () => {
    render(
      <EntityEventsTab
        entity={entity}
        events={[makeEvent(), makeEvent({ uuid: 'evt-002', name: 'order.paid', payload: undefined })]}
        onEventsChanged={noop}
      />,
    );
    expect(screen.getByText('order.cancelled')).toBeInTheDocument();
    expect(screen.getByText('order.paid')).toBeInTheDocument();
    expect(screen.getByText('1 field')).toBeInTheDocument();
  });

  it('shows the empty state when there are no events', () => {
    render(<EntityEventsTab entity={entity} events={[]} onEventsChanged={noop} />);
    expect(screen.getByText('No events')).toBeInTheDocument();
  });

  it('opens the "New event" panel from the toolbar button', () => {
    render(<EntityEventsTab entity={entity} events={[]} onEventsChanged={noop} />);
    fireEvent.click(screen.getAllByText('New event')[0]);
    expect(screen.getByText('New event', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. order.cancelled')).toBeInTheDocument();
  });

  it('POSTs /api/events and invokes onEventsChanged when a new event is saved', async () => {
    server.use(
      http.post('/api/events', () =>
        HttpResponse.json({ message: 'Event created successfully', data: makeEvent({ uuid: 'evt-new' }) }, { status: 201 }),
      ),
    );

    const onEventsChanged = vi.fn();
    render(<EntityEventsTab entity={entity} events={[]} onEventsChanged={onEventsChanged} />);

    fireEvent.click(screen.getByRole('button', { name: /new event/i }));
    fireEvent.change(screen.getByPlaceholderText('e.g. order.cancelled'), { target: { value: 'order.refunded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onEventsChanged).toHaveBeenCalled());
  });
});
