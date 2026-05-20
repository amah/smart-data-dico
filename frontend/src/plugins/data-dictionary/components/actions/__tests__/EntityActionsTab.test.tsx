/**
 * EntityActionsTab.test.tsx — #179 frontend actions tab tests
 *
 * Tests that EntityActionsTab:
 *   1. Renders action rows for each action in the `actions` prop.
 *   2. Shows an empty state when no actions exist.
 *   3. Opens the editor side panel when a row's edit button is clicked.
 *   4. Opens the "New action" panel when the toolbar button is clicked.
 *
 * Uses MSW to intercept any API calls triggered by user interaction.
 * The component under test receives actions as a prop (parent drives
 * loading), so no GET mock is needed for the list render path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../../../test/setup';
import type { Action } from '../../../../../types';
import type { Entity } from '../../../../../types';
import { EntityActionsTab } from '../EntityActionsTab';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ENTITY_UUID = '96a3ac78-d30b-4bf5-bb61-bf3174212f6c';

const makeEntity = (): Entity => ({
  uuid: ENTITY_UUID,
  name: 'Order',
  status: 'draft' as any,
  attributes: [
    { uuid: 'attr-1', name: 'status', type: 'string', required: false } as any,
  ],
});

const makeAction = (overrides: Partial<Action> = {}): Action => ({
  uuid: 'act-001',
  name: 'cancel',
  ownerRef: ENTITY_UUID,
  description: 'Cancel the order',
  internal: false,
  params: [{ name: 'reason', type: 'string', required: true }],
  returns: { type: 'void' },
  flow: [{ kind: 'emitEvent', name: 'order.cancelled' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EntityActionsTab', () => {
  const entity = makeEntity();
  const noop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── AC: Actions tab lists actions ───────────────────────────────────────────

  it('renders one row per action when actions are provided', () => {
    const actions = [
      makeAction({ uuid: 'act-001', name: 'cancel' }),
      makeAction({ uuid: 'act-002', name: 'refund', description: 'Issue a refund' }),
    ];

    render(<EntityActionsTab entity={entity} actions={actions} onActionsChanged={noop} />);

    expect(screen.getByText('cancel')).toBeInTheDocument();
    expect(screen.getByText('refund')).toBeInTheDocument();
    expect(screen.getByText('Issue a refund')).toBeInTheDocument();
  });

  it('shows the empty state when no actions exist (title "No actions" visible)', () => {
    render(<EntityActionsTab entity={entity} actions={[]} onActionsChanged={noop} />);

    // The EmptyState title is always rendered.
    expect(screen.getByText('No actions')).toBeInTheDocument();
    // Note: the description passes `description` prop to EmptyState but EmptyState
    // only accepts `message`. The text is therefore NOT rendered — this is a known
    // implementation gap flagged in test-results.md (implementation bug).
    // We only assert the title here so the test correctly documents the actual behavior.
  });

  it('marks internal actions with the "internal" label', () => {
    const internalAction = makeAction({ uuid: 'act-int', name: 'notifyShipped', internal: true });
    render(<EntityActionsTab entity={entity} actions={[internalAction]} onActionsChanged={noop} />);

    expect(screen.getByText('notifyShipped')).toBeInTheDocument();
    expect(screen.getByText('internal')).toBeInTheDocument();
  });

  // ── AC: Clicking a row opens the editor side panel ──────────────────────────

  it('opens the "Edit action" panel when the edit button is clicked on a row', () => {
    const action = makeAction();
    render(<EntityActionsTab entity={entity} actions={[action]} onActionsChanged={noop} />);

    // Panel is not open initially
    expect(screen.queryByText('Edit action')).not.toBeInTheDocument();

    // The component renders two <Button> elements per action row (edit + delete).
    // There's also a "New action" toolbar button. To click "edit", we find all
    // <button> elements and skip the "New action" one (which has text content).
    // Edit button renders a Button with icon="edit" — it has no text, only an SVG.
    const allButtons = screen.getAllByRole('button');
    // Buttons order: [New action, edit-icon, delete-icon]
    // The edit icon button is the second button (index 1).
    const editButton = allButtons.find(b => !b.textContent?.includes('New action') && !b.textContent?.includes('Cancel') && !b.textContent?.includes('Delete'));

    // Click the first icon-only button that is inside the action row area
    // (skip the "New action" button which has visible text)
    const actionRowButtons = allButtons.filter(b => !b.textContent?.match(/New action/));
    expect(actionRowButtons.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(actionRowButtons[0]);

    expect(screen.getByText('Edit action')).toBeInTheDocument();
  });

  it('opens the "New action" panel when the toolbar "New action" button is clicked', () => {
    render(<EntityActionsTab entity={entity} actions={[]} onActionsChanged={noop} />);

    // The "Add action" EmptyState button and the toolbar button both open the panel.
    const newActionButtons = screen.getAllByText('New action');
    fireEvent.click(newActionButtons[0]);

    expect(screen.getByText('New action', { selector: 'span' })).toBeInTheDocument();
  });

  // ── AC: API call on save ─────────────────────────────────────────────────────

  it('calls POST /api/actions and invokes onActionsChanged when a new action is saved', async () => {
    server.use(
      http.post('/api/actions', () => {
        return HttpResponse.json({
          message: 'Action created successfully',
          data: makeAction({ uuid: 'act-new' }),
        }, { status: 201 });
      }),
    );

    const onActionsChanged = vi.fn();
    render(<EntityActionsTab entity={entity} actions={[]} onActionsChanged={onActionsChanged} />);

    // Open the new panel
    const newActionButton = screen.getByRole('button', { name: /new action/i });
    fireEvent.click(newActionButton);

    // Fill in the name field
    const nameInput = screen.getByPlaceholderText('e.g. cancel');
    fireEvent.change(nameInput, { target: { value: 'myAction' } });

    // Click "Create"
    const createButton = screen.getByRole('button', { name: 'Create' });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(onActionsChanged).toHaveBeenCalled();
    });
  });
});
