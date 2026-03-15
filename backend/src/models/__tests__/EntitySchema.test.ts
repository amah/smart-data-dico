import { AttributeType, RelationshipType, validateEntity } from '../EntitySchema.js';

describe('EntitySchema', () => {
  describe('validateEntity', () => {
    it('should validate a valid entity', () => {
      const validEntity = {
        id: 'test-entity',
        uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693',
        name: 'Test Entity',
        description: 'A test entity',
        microservice: 'test-service',
        version: '1.0.0',
        attributes: [
          {
            uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694',
            name: 'id',
            description: 'Primary identifier',
            type: AttributeType.STRING,
            required: true,
          },
          {
            uuid: 'c5af3719-ee6f-4156-bb1a-e575d345f7a5',
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
        uuid: 'd6b0482a-ff70-4267-8c2b-f686e456f8b6',
        name: 'Test Entity',
        description: 'A test entity',
        microservice: 'test-service',
        version: '1.0.0',
        attributes: [
          {
            uuid: 'e7c1593b-aa81-4378-9d3c-a797f567a9c7',
            name: 'id',
            description: 'Primary identifier',
            type: AttributeType.STRING,
            required: true,
          },
        ],
        relationships: [
          {
            uuid: 'f8d26a4c-bb92-4489-ae4d-b8a8a678bad8',
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
