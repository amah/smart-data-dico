/**
 * #57 — EntityDiff component renders the existing → proposed diff for a
 * createEntity-on-existing collision. Pure-render test, no streaming.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EntityDiff } from '../AIChatPanel';

describe('EntityDiff (#57)', () => {
  it('shows added / removed / modified attribute sections', () => {
    const existing = {
      name: 'Order',
      description: 'old',
      attributes: [
        { name: 'id', type: 'string', required: true, primaryKey: true },
        { name: 'amount', type: 'number', required: false },
      ],
    };
    const proposed = {
      name: 'Order',
      description: 'new',
      attributes: [
        { name: 'id', type: 'string', required: true, primaryKey: true },
        { name: 'amount', type: 'number', required: true },
        { name: 'currency', type: 'string', required: true },
      ],
    };

    render(<EntityDiff existing={existing} proposed={proposed} />);
    expect(screen.getByTestId('ai-entity-diff')).toBeInTheDocument();
    // description changed
    expect(screen.getByText(/description/)).toBeInTheDocument();
    expect(screen.getByText('old')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
    // currency added
    expect(screen.getByText(/Added attributes \(1\)/)).toBeInTheDocument();
    // amount required-flag flipped → modified
    expect(screen.getByText(/Modified attributes \(1\)/)).toBeInTheDocument();
  });

  it('reports "no diff" when nothing changes', () => {
    const same = {
      name: 'Order',
      description: 'd',
      attributes: [{ name: 'id', type: 'string', required: true, primaryKey: true }],
    };
    render(<EntityDiff existing={same} proposed={same} />);
    expect(screen.getByText(/No diff/i)).toBeInTheDocument();
  });

  it('handles missing existing attributes gracefully', () => {
    render(<EntityDiff existing={{ name: 'X' }} proposed={{ name: 'X', attributes: [{ name: 'a', type: 'string' }] }} />);
    expect(screen.getByText(/Added attributes \(1\)/)).toBeInTheDocument();
  });
});
