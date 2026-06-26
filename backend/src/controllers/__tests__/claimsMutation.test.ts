/**
 * #confab-guard — the claimsMutation() heuristic decides whether an assistant
 * turn ASSERTED a model change. Combined with a count of successful mutating
 * tool calls, a claim with zero mutations is flagged as a confabulated no-op.
 */
import { claimsMutation } from '../aiController.js';

describe('claimsMutation', () => {
  it('flags explicit success claims', () => {
    for (const t of [
      'Done! Created three domain events on the Order aggregate.',
      '✅ Updates applied: sku pattern added.',
      'I created the Order entity and added a status attribute.',
      'Updated Product (attributes unchanged).',
      'Deleted the relationship between Order and Customer.',
      'Both actions created successfully.',
    ]) {
      expect(claimsMutation(t)).toBe(true);
    }
  });

  it('does NOT flag read / explain / question turns', () => {
    for (const t of [
      'Here is what I found: the Order entity has 5 attributes.',
      'The catalog package contains Product and Category.',
      'Would you like me to create an Order entity?',
      'I can model this as a state machine — shall I proceed?',
      'This relationship looks correct; no changes needed.',
      '',
    ]) {
      expect(claimsMutation(t)).toBe(false);
    }
  });
});
