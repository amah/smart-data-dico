import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

/**
 * Swagger definition options
 */
const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Data Dictionary Management System API',
      version: '1.0.0',
      description: 'API documentation for the Data Dictionary Management System',
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
      contact: {
        name: 'API Support',
        email: 'support@datadictionary.com',
      },
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        basicAuth: {
          type: 'http',
          scheme: 'basic',
          description: 'Basic authentication with username and password',
        },
      },
      schemas: {
        Entity: {
          type: 'object',
          required: ['id', 'name', 'description', 'microservice', 'version', 'attributes'],
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier for the entity',
            },
            name: {
              type: 'string',
              description: 'Name of the entity',
            },
            description: {
              type: 'string',
              description: 'Description of the entity',
            },
            microservice: {
              type: 'string',
              description: 'Microservice that the entity belongs to',
            },
            version: {
              type: 'string',
              description: 'Version of the entity schema',
            },
            attributes: {
              type: 'array',
              description: 'List of attributes for the entity',
              items: {
                $ref: '#/components/schemas/EntityAttribute',
              },
            },
            relationships: {
              type: 'array',
              description: 'List of relationships for the entity',
              items: {
                $ref: '#/components/schemas/EntityRelationship',
              },
            },
            metadata: {
              type: 'object',
              description: 'Additional metadata for the entity',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Timestamp when the entity was created',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Timestamp when the entity was last updated',
            },
          },
        },
        EntityAttribute: {
          type: 'object',
          required: ['name', 'description', 'type', 'required'],
          properties: {
            name: {
              type: 'string',
              description: 'Name of the attribute',
            },
            description: {
              type: 'string',
              description: 'Description of the attribute',
            },
            type: {
              type: 'string',
              description: 'Data type of the attribute',
              enum: ['string', 'number', 'integer', 'boolean', 'datetime', 'date', 'time', 'enum', 'object', 'array', 'reference'],
            },
            required: {
              type: 'boolean',
              description: 'Whether the attribute is required',
            },
            unique: {
              type: 'boolean',
              description: 'Whether the attribute value must be unique',
            },
            defaultValue: {
              description: 'Default value for the attribute',
            },
            examples: {
              type: 'array',
              description: 'Example values for the attribute',
              items: {
                type: 'string',
              },
            },
            minLength: {
              type: 'integer',
              description: 'Minimum length for string attributes',
            },
            maxLength: {
              type: 'integer',
              description: 'Maximum length for string attributes',
            },
            pattern: {
              type: 'string',
              description: 'Regex pattern for string attributes',
            },
            format: {
              type: 'string',
              description: 'Format for the attribute (e.g., email, uuid)',
            },
            minimum: {
              type: 'number',
              description: 'Minimum value for number attributes',
            },
            maximum: {
              type: 'number',
              description: 'Maximum value for number attributes',
            },
            precision: {
              type: 'integer',
              description: 'Precision for number attributes',
            },
            scale: {
              type: 'integer',
              description: 'Scale for number attributes',
            },
            enumValues: {
              type: 'array',
              description: 'Possible values for enum attributes',
              items: {
                type: 'string',
              },
            },
            metadata: {
              type: 'object',
              description: 'Additional metadata for the attribute',
            },
          },
        },
        EntityRelationship: {
          type: 'object',
          required: ['name', 'description', 'type', 'target', 'required'],
          properties: {
            name: {
              type: 'string',
              description: 'Name of the relationship',
            },
            description: {
              type: 'string',
              description: 'Description of the relationship',
            },
            type: {
              type: 'string',
              description: 'Type of the relationship',
              enum: ['hasOne', 'hasMany', 'belongsTo', 'manyToMany'],
            },
            target: {
              type: 'string',
              description: 'Target entity of the relationship (format: microservice.entity)',
            },
            inverseName: {
              type: 'string',
              description: 'Name of the inverse relationship in the target entity',
            },
            required: {
              type: 'boolean',
              description: 'Whether the relationship is required',
            },
            foreignKey: {
              type: 'string',
              description: 'Foreign key attribute name',
            },
            metadata: {
              type: 'object',
              description: 'Additional metadata for the relationship',
            },
          },
        },
        GraphData: {
          type: 'object',
          properties: {
            nodes: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/GraphNode',
              },
            },
            edges: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/GraphEdge',
              },
            },
          },
        },
        GraphNode: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier for the node',
            },
            label: {
              type: 'string',
              description: 'Label for the node',
            },
            type: {
              type: 'string',
              description: 'Type of the node',
            },
            service: {
              type: 'string',
              description: 'Service that the node belongs to',
            },
          },
        },
        GraphEdge: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier for the edge',
            },
            source: {
              type: 'string',
              description: 'Source node ID',
            },
            target: {
              type: 'string',
              description: 'Target node ID',
            },
            label: {
              type: 'string',
              description: 'Label for the edge',
            },
            type: {
              type: 'string',
              description: 'Type of the edge',
            },
          },
        },
        CommitInfo: {
          type: 'object',
          properties: {
            hash: {
              type: 'string',
              description: 'Commit hash',
            },
            date: {
              type: 'string',
              description: 'Commit date',
            },
            message: {
              type: 'string',
              description: 'Commit message',
            },
            author_name: {
              type: 'string',
              description: 'Author name',
            },
            author_email: {
              type: 'string',
              description: 'Author email',
            },
          },
        },
        SearchResult: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['entity', 'attribute'],
              description: 'Type of search result',
            },
            service: {
              type: 'string',
              description: 'Service name',
            },
            entityName: {
              type: 'string',
              description: 'Entity name',
            },
            attributeName: {
              type: 'string',
              description: 'Attribute name (for attribute results)',
            },
            description: {
              type: 'string',
              description: 'Description of the entity or attribute',
            },
            path: {
              type: 'string',
              description: 'Path to the entity or attribute',
            },
            score: {
              type: 'number',
              description: 'Search relevance score',
            },
          },
        },
      },
    },
  },
  apis: ['./src/routes/**/*.ts', './src/controllers/*.ts'],
};

/**
 * Swagger specification
 */
const swaggerSpec = swaggerJsdoc(options);

/**
 * Configure Swagger middleware for Express
 * @param app Express application
 */
export const setupSwagger = (app: Express): void => {
  // Swagger UI route
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  // Swagger JSON route
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
};