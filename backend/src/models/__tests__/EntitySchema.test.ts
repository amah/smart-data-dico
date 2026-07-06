import { AttributeType, validateEntity, fillAttributeDefaults } from '../EntitySchema.js';

describe('EntitySchema', () => {
  describe('fillAttributeDefaults', () => {
    // Reproduces the "instance.attribute[1] requires property \"required\"" failure
    // that blocked a metadata-only save (e.g. setting system.style from the diagram).
    const brokenEntity = () => ({
      uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693',
      name: 'BrokenAttr',
      attributes: [
        { uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694', name: 'id', description: 'id', type: AttributeType.STRING, required: true },
        // 2nd attribute is missing `required` AND `description` (imported/RE gap)
        { uuid: 'c5af3719-ee6f-4156-bb1a-e575d345f7a5', name: 'label', type: AttributeType.STRING },
      ],
    });

    it('the gap fails validation before healing', () => {
      const r = validateEntity(brokenEntity() as any);
      expect(r.valid).toBe(false);
      expect(r.errors.join(' ')).toMatch(/required|description/);
    });

    it('backfills required:false and description:"" so the entity validates', () => {
      const healed = fillAttributeDefaults(brokenEntity() as any);
      expect(healed.attributes![1].required).toBe(false);
      expect(healed.attributes![1].description).toBe('');
      expect(healed.attributes![0].required).toBe(true); // existing values untouched
      expect(validateEntity(healed).valid).toBe(true);
    });

    it('recurses into nested embedded properties', () => {
      const e: any = {
        uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693', name: 'E',
        attributes: [{ uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694', name: 'addr', type: AttributeType.OBJECT,
          properties: [{ uuid: 'c5af3719-ee6f-4156-bb1a-e575d345f7a5', name: 'city', type: AttributeType.STRING }] }],
      };
      fillAttributeDefaults(e);
      expect(e.attributes[0].properties[0].required).toBe(false);
      expect(e.attributes[0].properties[0].description).toBe('');
    });
  });

  describe('validateEntity', () => {
    it('should validate a valid entity', () => {
      const validEntity = {
        uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693',
        name: 'Test Entity',
        attributes: [
          {
            uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694',
            name: 'id',
            description: 'Primary identifier',
            type: AttributeType.STRING,
            required: true,
            primaryKey: true,
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
        // Missing uuid
        // Missing name
        description: 'A test entity',
        attributes: [],
      };

      const result = validateEntity(invalidEntity as any);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate an entity with validation metadata (#85)', () => {
      const entityWithValidation = {
        uuid: 'd6b0482a-ff70-4267-8c2b-f686e456f8b6',
        name: 'Test Entity',
        description: 'A test entity',
        attributes: [
          {
            uuid: 'e7c1593b-aa81-4378-9d3c-a797f567a9c7',
            name: 'email',
            description: 'Email address',
            type: AttributeType.STRING,
            required: true,
            validation: {
              maxLength: 255,
              pattern: '^[^@]+@[^@]+$',
              format: 'email',
            },
          },
        ],
      };

      const result = validateEntity(entityWithValidation);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts any string attribute type — derived types are validated at config time (#107)', () => {
      // Since #107, `type` may be a standard AttributeType OR the name of a
      // derived type declared in dico.config.json. validateEntity only requires
      // `type` to be a string; unknown names are resolved/rejected at
      // `PUT /api/config/types`, not here.
      const entityWithDerivedType = {
        uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693',
        name: 'Test Entity',
        description: 'A test entity',
        attributes: [
          {
            uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694',
            name: 'email',
            description: 'Contact email',
            type: 'email', // a derived-type name, not a standard AttributeType
            required: true,
          },
        ],
      };

      const result = validateEntity(entityWithDerivedType as any);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate an entity with metadata entries', () => {
      const entityWithMetadata = {
        uuid: 'a38d1597-cc4f-4934-bb08-c876c023f693',
        name: 'Test Entity',
        attributes: [
          {
            uuid: 'b49e2608-dd5f-4045-aa09-d464c234e694',
            name: 'id',
            description: 'Primary identifier',
            type: AttributeType.STRING,
            required: true,
            metadata: [
              { name: 'sensitive', value: true },
            ],
          },
        ],
        metadata: [
          { name: 'owner', value: 'team-a' },
        ],
      };

      const result = validateEntity(entityWithMetadata);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
