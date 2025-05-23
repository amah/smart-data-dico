import { AttributeType, RelationshipType, validateEntity } from '../EntitySchema';

describe('EntitySchema', () => {
  describe('validateEntity', () => {
    it('should validate a valid entity', () => {
      const validEntity = {
        id: 'test-entity',
        name: 'Test Entity',
        description: 'A test entity',
        microservice: 'test-service',
        version: '1.0.0',
        attributes: [
          {
            name: 'id',
            description: 'Primary identifier',
            type: AttributeType.STRING,
            required: true,
          },
          {
            name: 'name',
            description: 'Entity name',
            type: AttributeType.STRING,
            required: true,
          },
        ],
      };

      const result = validateEntity(validEntity);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should invalidate an entity with missing required fields', () => {
      const invalidEntity = {
        id: 'test-entity',
        // Missing name
        description: 'A test entity',
        // Missing microservice
        version: '1.0.0',
        attributes: [],
      };

      const result = validateEntity(invalidEntity as any);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate an entity with relationships', () => {
      const entityWithRelationships = {
        id: 'test-entity',
        name: 'Test Entity',
        description: 'A test entity',
        microservice: 'test-service',
        version: '1.0.0',
        attributes: [
          {
            name: 'id',
            description: 'Primary identifier',
            type: AttributeType.STRING,
            required: true,
          },
        ],
        relationships: [
          {
            name: 'items',
            description: 'Related items',
            type: RelationshipType.HAS_MANY,
            target: 'Item',
            required: false,
          },
        ],
      };

      const result = validateEntity(entityWithRelationships);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should invalidate an entity with invalid attribute type', () => {
      const entityWithInvalidAttribute = {
        id: 'test-entity',
        name: 'Test Entity',
        description: 'A test entity',
        microservice: 'test-service',
        version: '1.0.0',
        attributes: [
          {
            name: 'id',
            description: 'Primary identifier',
            type: 'invalid-type', // Invalid type
            required: true,
          },
        ],
      };

      const result = validateEntity(entityWithInvalidAttribute as any);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});