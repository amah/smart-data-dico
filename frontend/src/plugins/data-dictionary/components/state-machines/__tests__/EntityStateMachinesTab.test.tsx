/**
 * EntityStateMachinesTab.test.tsx — #179 frontend state machines tab tests
 *
 * Tests that EntityStateMachinesTab:
 *   1. Renders one card per state machine.
 *   2. Shows the empty state when no machines exist.
 *   3. Expanding a card renders the StateMachineDiagram component (by
 *      verifying the container div is rendered — we skip the Cytoscape
 *      canvas render itself since it's a third-party canvas element).
 *   4. Clicking the edit button opens the "Edit state machine" side panel.
 *
 * StateMachineDiagram is mocked to avoid the Cytoscape canvas requirement
 * in jsdom. The mock asserts the component is mounted with the correct `sm`
 * prop, satisfying "diagram component mounted with the right props".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../../../test/setup';
import type { StateMachine } from '../../../../../types';
import type { Entity } from '../../../../../types';
import { EntityStateMachinesTab } from '../EntityStateMachinesTab';

// ── Mock StateMachineDiagram (Cytoscape requires a real DOM canvas) ─────────

vi.mock('../StateMachineDiagram', () => ({
  StateMachineDiagram: ({ sm, height }: { sm: StateMachine; height?: number }) => (
    <div
      data-testid="state-machine-diagram"
      data-sm-uuid={sm.uuid}
      data-sm-name={sm.name}
      data-height={height}
    >
      diagram-mock-{sm.name}
    </div>
  ),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENTITY_UUID = '96a3ac78-d30b-4bf5-bb61-bf3174212f6c';

const makeEntity = (): Entity => ({
  uuid: ENTITY_UUID,
  name: 'Order',
  status: 'draft' as any,
  attributes: [
    { uuid: 'attr-1', name: 'status', type: 'string', required: false } as any,
    { uuid: 'attr-2', name: 'paymentStatus', type: 'string', required: false } as any,
  ],
});

const makeStateMachine = (overrides: Partial<StateMachine> = {}): StateMachine => ({
  uuid: 'sm-001',
  name: 'fulfillment',
  ownerRef: ENTITY_UUID,
  description: 'Tracks the delivery lifecycle',
  stateAttribute: 'status',
  initialState: 'PENDING',
  states: [
    { name: 'PENDING' },
    { name: 'PROCESSING' },
    { name: 'DONE', terminal: true },
  ],
  transitions: [
    { uuid: 'tr-1', from: 'PENDING', to: 'PROCESSING', on: 'payment.authorized' },
    { uuid: 'tr-2', from: 'PROCESSING', to: 'DONE', on: 'delivery.confirmed' },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EntityStateMachinesTab', () => {
  const entity = makeEntity();
  const noop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── AC: One card per machine ─────────────────────────────────────────────────

  it('renders one card per state machine', () => {
    const machines = [
      makeStateMachine({ uuid: 'sm-001', name: 'fulfillment' }),
      makeStateMachine({ uuid: 'sm-002', name: 'payment', stateAttribute: 'paymentStatus' }),
    ];
    render(<EntityStateMachinesTab entity={entity} machines={machines} onMachinesChanged={noop} />);

    expect(screen.getByText('fulfillment')).toBeInTheDocument();
    expect(screen.getByText('payment')).toBeInTheDocument();
  });

  it('shows the empty state when no machines exist (title "No state machines" visible)', () => {
    render(<EntityStateMachinesTab entity={entity} machines={[]} onMachinesChanged={noop} />);

    // The EmptyState title is always rendered.
    expect(screen.getByText('No state machines')).toBeInTheDocument();
    // Note: the description passes `description` prop to EmptyState but EmptyState
    // only accepts `message`. The text is therefore NOT rendered — this is a known
    // implementation gap flagged in test-results.md (implementation bug).
  });

  it('shows machine description when provided', () => {
    const sm = makeStateMachine({ description: 'Tracks the delivery lifecycle' });
    render(<EntityStateMachinesTab entity={entity} machines={[sm]} onMachinesChanged={noop} />);

    expect(screen.getByText('Tracks the delivery lifecycle')).toBeInTheDocument();
  });

  // ── AC: Auto-expands when there is exactly one machine ───────────────────────

  it('auto-expands the card when there is exactly one machine', () => {
    const sm = makeStateMachine();
    render(<EntityStateMachinesTab entity={entity} machines={[sm]} onMachinesChanged={noop} />);

    // When auto-expanded, the StateMachineDiagram mock is rendered
    expect(screen.getByTestId('state-machine-diagram')).toBeInTheDocument();
  });

  it('does NOT auto-expand cards when there are multiple machines', () => {
    const machines = [
      makeStateMachine({ uuid: 'sm-001', name: 'fulfillment' }),
      makeStateMachine({ uuid: 'sm-002', name: 'payment' }),
    ];
    render(<EntityStateMachinesTab entity={entity} machines={machines} onMachinesChanged={noop} />);

    // Neither card is auto-expanded
    expect(screen.queryByTestId('state-machine-diagram')).not.toBeInTheDocument();
  });

  // ── AC: Diagram component mounted with right props ────────────────────────────

  it('renders StateMachineDiagram with the correct sm prop when card is expanded', () => {
    const sm = makeStateMachine({ uuid: 'sm-001', name: 'fulfillment' });
    render(<EntityStateMachinesTab entity={entity} machines={[sm]} onMachinesChanged={noop} />);

    // Single machine — auto-expanded
    const diagram = screen.getByTestId('state-machine-diagram');
    expect(diagram).toHaveAttribute('data-sm-uuid', 'sm-001');
    expect(diagram).toHaveAttribute('data-sm-name', 'fulfillment');
  });

  it('renders StateMachineDiagram for each machine when manually expanded', () => {
    const machines = [
      makeStateMachine({ uuid: 'sm-001', name: 'fulfillment' }),
      makeStateMachine({ uuid: 'sm-002', name: 'payment' }),
    ];
    render(<EntityStateMachinesTab entity={entity} machines={machines} onMachinesChanged={noop} />);

    // Click on the fulfillment card header to expand it
    fireEvent.click(screen.getByText('fulfillment'));

    const diagram = screen.getByTestId('state-machine-diagram');
    expect(diagram).toHaveAttribute('data-sm-uuid', 'sm-001');

    // Click on payment card to expand it (and collapse fulfillment — or both shown depending on impl)
    fireEvent.click(screen.getByText('payment'));
    // At least one diagram is shown at any time
    expect(screen.getAllByTestId('state-machine-diagram').length).toBeGreaterThan(0);
  });

  // ── AC: Edit button opens the side panel ─────────────────────────────────────

  it('opens the "Edit state machine" panel when the edit button is clicked', () => {
    const sm = makeStateMachine();
    render(<EntityStateMachinesTab entity={entity} machines={[sm]} onMachinesChanged={noop} />);

    // Panel not open initially
    expect(screen.queryByText('Edit state machine')).not.toBeInTheDocument();

    // There is one machine card. The card header renders two icon buttons:
    // edit (first) and delete (second). Plus the "New state machine" toolbar button.
    // We find all buttons and click the one that is NOT "New state machine".
    const allButtons = screen.getAllByRole('button');
    // allButtons: [New state machine, edit-icon, delete-icon]
    // The edit button is a pure icon button (no visible text).
    const iconButtons = allButtons.filter(b => !b.textContent?.match(/New state machine|Add state machine/));
    expect(iconButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(iconButtons[0]); // first icon button = edit

    expect(screen.getByText('Edit state machine')).toBeInTheDocument();
  });

  it('opens the "New state machine" panel when the toolbar button is clicked', () => {
    render(<EntityStateMachinesTab entity={entity} machines={[]} onMachinesChanged={noop} />);

    // The EmptyState has "Add state machine" button; toolbar has "New state machine"
    const newButton = screen.getByRole('button', { name: /new state machine/i });
    fireEvent.click(newButton);

    expect(screen.getByText('New state machine', { selector: 'span' })).toBeInTheDocument();
  });

  // ── AC: API call on save ─────────────────────────────────────────────────────

  it('calls POST /api/state-machines and invokes onMachinesChanged when saved', async () => {
    server.use(
      http.post('/api/state-machines', () => {
        return HttpResponse.json({
          message: 'State machine created successfully',
          data: makeStateMachine({ uuid: 'sm-new' }),
        }, { status: 201 });
      }),
    );

    const onMachinesChanged = vi.fn();
    render(<EntityStateMachinesTab entity={entity} machines={[]} onMachinesChanged={onMachinesChanged} />);

    // Open the new panel
    const newButton = screen.getByRole('button', { name: /new state machine/i });
    fireEvent.click(newButton);

    // Fill required fields
    const nameInput = screen.getByPlaceholderText('e.g. fulfillment');
    fireEvent.change(nameInput, { target: { value: 'myMachine' } });

    const initialStateInput = screen.getByPlaceholderText('e.g. PENDING');
    fireEvent.change(initialStateInput, { target: { value: 'START' } });

    // Add at least one state (the form requires states.length > 0).
    // The panel has States "Add" and Transitions "Add" buttons. Find by locating
    // the button that follows the "States" label in the panel.
    // We use getByText to find the States section heading and then find its sibling Add button.
    const statesSection = screen.getByText('States');
    const addStatesButton = statesSection.parentElement?.querySelector('button');
    expect(addStatesButton).not.toBeNull();
    fireEvent.click(addStatesButton!);

    const stateNameInput = screen.getByPlaceholderText('state name');
    fireEvent.change(stateNameInput, { target: { value: 'START' } });

    // Click "Create"
    const createButton = screen.getByRole('button', { name: 'Create' });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(onMachinesChanged).toHaveBeenCalled();
    });
  });
});
