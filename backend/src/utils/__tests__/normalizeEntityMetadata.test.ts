/**
 * Tests for the non-mutating contract on normalizeEntityMetadata (#77).
 *
 * The function returns the canonical shape but must NOT touch the input
 * object. Otherwise an incidental write of the same in-memory object back
 * to disk would silently persist the legacy→canonical normalization,
 * polluting git history with ghost diffs.
 */
import { normalizeEntityMetadata } from '../fileOperations.js';

jest.mock('../logger');

describe('normalizeEntityMetadata — non-mutating contract (#77)', () => {
  it('returns null when given null', () => {
    expect(normalizeEntityMetadata(null)).toBeNull();
  });

  it('does not touch an entity that is already in canonical shape', () => {
    const entity: any = {
      uuid: 'e-1',
      name: 'Customer',
      attributes: [
        {
          uuid: 'a-1',
          name: 'email',
          type: 'string',
          required: true,
          description: 'email',
          metadata: [{ name: 'pii', value: true }],
          constraints: { format: 'email', minLength: 5 },
        },
      ],
      metadata: [{ name: 'owner', value: 'data-team' }],
    };
    const original = JSON.stringify(entity);
    const result = normalizeEntityMetadata(entity);

    // Input object identity preserved? No — we deep clone. But the input
    // VALUE must be unchanged.
    expect(JSON.stringify(entity)).toBe(original);
    // And the result must be a different reference but structurally equal.
    expect(result).not.toBe(entity);
    expect(JSON.stringify(result)).toBe(original);
  });

  it('legacy object-shape attribute metadata: input stays object, result is array', () => {
    const entity: any = {
      uuid: 'e-1',
      name: 'Order',
      attributes: [
        {
          uuid: 'a-1',
          name: 'id',
          type: 'string',
          required: true,
          description: 'id',
          metadata: { isPrimaryKey: true },
        },
      ],
    };

    const result = normalizeEntityMetadata(entity);

    // Input MUST still be the legacy object form
    expect(entity.attributes[0].metadata).toEqual({ isPrimaryKey: true });
    expect(Array.isArray(entity.attributes[0].metadata)).toBe(false);

    // Result MUST be the canonical array form
    expect(Array.isArray(result!.attributes[0].metadata)).toBe(true);
    expect(result!.attributes[0].metadata).toEqual([
      { name: 'isPrimaryKey', value: true },
    ]);
  });

  it('legacy flat constraint fields: input keeps flat fields, result has nested constraints', () => {
    const entity: any = {
      uuid: 'e-1',
      name: 'User',
      attributes: [
        {
          uuid: 'a-1',
          name: 'email',
          type: 'string',
          required: true,
          description: 'email',
          format: 'email',
          minLength: 5,
          maxLength: 100,
          pattern: '^.+@.+$',
        },
      ],
    };

    const result = normalizeEntityMetadata(entity);

    // Input MUST still have the flat constraint fields directly on the attribute
    expect(entity.attributes[0].format).toBe('email');
    expect(entity.attributes[0].minLength).toBe(5);
    expect(entity.attributes[0].maxLength).toBe(100);
    expect(entity.attributes[0].pattern).toBe('^.+@.+$');
    // And no nested constraints object on the input
    expect(entity.attributes[0].constraints).toBeUndefined();

    // Result MUST have the canonical nested constraints
    expect(result!.attributes[0].constraints).toEqual({
      format: 'email',
      minLength: 5,
      maxLength: 100,
      pattern: '^.+@.+$',
    });
    // And the flat fields must NOT be on the result root anymore
    expect((result!.attributes[0] as any).format).toBeUndefined();
    expect((result!.attributes[0] as any).minLength).toBeUndefined();
  });

  it('mixed legacy + canonical fields normalize cleanly without mutating input', () => {
    const entity: any = {
      uuid: 'e-1',
      name: 'Mixed',
      attributes: [
        {
          uuid: 'a-1',
          name: 'mixed',
          type: 'string',
          required: true,
          description: 'mixed',
          // Already has nested constraints
          constraints: { format: 'date' },
          // But ALSO has a flat legacy field that should merge in
          maxLength: 30,
          // And legacy object-shape metadata
          metadata: { sensitive: false },
        },
      ],
      metadata: { owner: 'team' },
    };
    const inputBefore = JSON.stringify(entity);

    const result = normalizeEntityMetadata(entity);

    // Input is untouched
    expect(JSON.stringify(entity)).toBe(inputBefore);

    // Result has merged constraints
    expect(result!.attributes[0].constraints).toEqual({
      format: 'date',
      maxLength: 30,
    });
    // Result has array metadata
    expect(result!.attributes[0].metadata).toEqual([
      { name: 'sensitive', value: false },
    ]);
    // Entity-level metadata also normalized
    expect(result!.metadata).toEqual([{ name: 'owner', value: 'team' }]);
  });

  it('entity-level metadata normalization is also non-mutating', () => {
    const entity: any = {
      uuid: 'e-1',
      name: 'X',
      attributes: [],
      metadata: { kind: 'aggregate' },
    };

    const result = normalizeEntityMetadata(entity);

    expect(entity.metadata).toEqual({ kind: 'aggregate' });
    expect(Array.isArray(entity.metadata)).toBe(false);
    expect(result!.metadata).toEqual([{ name: 'kind', value: 'aggregate' }]);
  });

  it('mutating the result does not leak back into the input', () => {
    const entity: any = {
      uuid: 'e-1',
      name: 'X',
      attributes: [{ uuid: 'a', name: 'a', type: 'string', required: true, description: '', metadata: [{ name: 'k', value: 1 }] }],
    };
    const result = normalizeEntityMetadata(entity);

    // Mutate the result
    result!.attributes[0].name = 'CHANGED';
    result!.attributes[0].metadata!.push({ name: 'extra', value: true });

    // Input is unaffected
    expect(entity.attributes[0].name).toBe('a');
    expect(entity.attributes[0].metadata).toHaveLength(1);
  });
});
