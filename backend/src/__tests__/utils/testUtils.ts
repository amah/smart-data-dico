import { Express } from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

/**
 * Creates a test client for making HTTP requests to the Express app
 * @param app Express application
 * @returns Supertest instance
 */
export const createTestClient = (app: Express) => {
  return request(app);
};

/**
 * Creates a temporary test directory for file operations
 * @param dirPath Directory path to create
 */
export const createTestDirectory = (dirPath: string): void => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

/**
 * Removes a test directory and all its contents
 * @param dirPath Directory path to remove
 */
export const removeTestDirectory = (dirPath: string): void => {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
};

/**
 * Creates a test YAML file with the given content
 * @param filePath Path to create the file
 * @param content Content to write to the file
 */
export const createTestYamlFile = (filePath: string, content: string): void => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content);
};

/**
 * Generates a random entity for testing
 * @param overrides Properties to override in the generated entity
 * @returns A test entity
 */
export const generateTestEntity = (overrides = {}) => {
  return {
    id: `test-entity-${Date.now()}`,
    name: 'TestEntity',
    description: 'A test entity for unit tests',
    microservice: 'test-service',
    version: '1.0.0',
    attributes: [
      {
        name: 'id',
        description: 'Primary identifier',
        type: 'string',
        required: true,
      },
      {
        name: 'name',
        description: 'Entity name',
        type: 'string',
        required: true,
      },
    ],
    ...overrides,
  };
};