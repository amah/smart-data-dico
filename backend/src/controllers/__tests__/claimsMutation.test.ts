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
      'I updated the Product entity (no attribute changes).',
      'Deleted the relationship between Order and Customer.',
      'Both actions created successfully.',
    ]) {
      expect(claimsMutation(t)).toBe(true);
    }
  });

  it('flags "<verb> <concept> <Name>" claims with no determiner (the loan-app miss)', () => {
    for (const t of [
      'Created state machine LoanLifecycle on Loan with states ACTIVE, DELINQUENT, PAID_OFF.',
      'Created event OrderPlaced on the Order aggregate.',
      'added a rule to the Order entity.',
      'Created relationship Category → Product.',
      'Created derived type money based on number.',
      'updated stereotype aggregate-root.',
    ]) {
      expect(claimsMutation(t)).toBe(true);
    }
  });

  it('does NOT flag participle-adjective uses of a mutation verb', () => {
    // "the updated entity" / "that created rule" describe an existing thing —
    // the verb is an adjective, not a claim of having just done it.
    for (const t of [
      'The updated entity reflects the new attribute.',
      'Here is the created state machine diagram below.',
      'That created rule is still active on the model.',
      'This updated state machine renders below.',
    ]) {
      expect(claimsMutation(t)).toBe(false);
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

  it('does NOT flag mutation verbs used DESCRIPTIVELY in an SQL/analysis turn', () => {
    // Regression: a read-only "write & review SQL" turn that names a
    // `deleted_flag` column ("a 'deleted' column name") or emits CREATE TABLE
    // must not be mistaken for a confabulated change.
    for (const t of [
      'The timestamp is stored as an integer with a "deleted" column name — semantically wrong.',
      'Here is the DDL:\n```sql\nCREATE TABLE t (\n  deleted_flag INT,\n  updated_at TIMESTAMP\n);\n```\nThe mapping looks inconsistent.',
      'The column `cust_email_addr` is a BOOLEAN, which cannot hold an order number.',
    ]) {
      expect(claimsMutation(t)).toBe(false);
    }
  });
});
