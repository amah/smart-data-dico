/**
 * Smoke test for the saved-prompts routes (#123).
 *
 * Mocks promptService so we don't touch the filesystem; verifies each
 * controller wires request/response to the service correctly.
 */

import express, { type Express } from 'express';
import request from 'supertest';

jest.mock('../../services/promptService', () => ({
  promptService: {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { promptService } = require('../../services/promptService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ai = require('../aiController');

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.get('/api/ai/prompts', ai.listPrompts);
  app.get('/api/ai/prompts/:id', ai.getPrompt);
  app.post('/api/ai/prompts', ai.createPrompt);
  app.put('/api/ai/prompts/:id', ai.updatePrompt);
  app.delete('/api/ai/prompts/:id', ai.deletePrompt);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('aiController prompt routes', () => {
  it('GET /api/ai/prompts returns the service list', async () => {
    promptService.list.mockReturnValue([
      { id: 'a', name: 'A', content: 'one', createdAt: 't', updatedAt: 't' },
    ]);
    const res = await request(buildApp()).get('/api/ai/prompts');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('a');
    expect(promptService.list).toHaveBeenCalledTimes(1);
  });

  it('GET /api/ai/prompts/:id returns a single prompt', async () => {
    promptService.get.mockReturnValue({ id: 'x', name: 'N', content: 'C', createdAt: 't', updatedAt: 't' });
    const res = await request(buildApp()).get('/api/ai/prompts/x');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('x');
    expect(promptService.get).toHaveBeenCalledWith('x');
  });

  it('GET /api/ai/prompts/:id returns 404 when missing', async () => {
    promptService.get.mockReturnValue(null);
    const res = await request(buildApp()).get('/api/ai/prompts/nope');
    expect(res.status).toBe(404);
  });

  it('POST /api/ai/prompts validates name', async () => {
    const res = await request(buildApp()).post('/api/ai/prompts').send({ content: 'x' });
    expect(res.status).toBe(400);
    expect(promptService.create).not.toHaveBeenCalled();
  });

  it('POST /api/ai/prompts validates content', async () => {
    const res = await request(buildApp()).post('/api/ai/prompts').send({ name: 'X' });
    expect(res.status).toBe(400);
    expect(promptService.create).not.toHaveBeenCalled();
  });

  it('POST /api/ai/prompts creates a prompt', async () => {
    promptService.create.mockReturnValue({ id: 'new', name: 'N', content: 'C', createdAt: 't', updatedAt: 't' });
    const res = await request(buildApp()).post('/api/ai/prompts').send({ name: 'N', content: 'C' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe('new');
    expect(promptService.create).toHaveBeenCalledWith({ name: 'N', content: 'C' });
  });

  it('PUT /api/ai/prompts/:id updates a prompt', async () => {
    promptService.update.mockReturnValue({ id: 'x', name: 'New', content: 'Body', createdAt: 't', updatedAt: 't2' });
    const res = await request(buildApp()).put('/api/ai/prompts/x').send({ name: 'New' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('New');
    expect(promptService.update).toHaveBeenCalledWith('x', { name: 'New', content: undefined });
  });

  it('PUT /api/ai/prompts/:id returns 404 when missing', async () => {
    promptService.update.mockReturnValue(null);
    const res = await request(buildApp()).put('/api/ai/prompts/nope').send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/ai/prompts/:id removes a prompt', async () => {
    promptService.delete.mockReturnValue(true);
    const res = await request(buildApp()).delete('/api/ai/prompts/x');
    expect(res.status).toBe(200);
    expect(promptService.delete).toHaveBeenCalledWith('x');
  });

  it('DELETE /api/ai/prompts/:id returns 404 when missing', async () => {
    promptService.delete.mockReturnValue(false);
    const res = await request(buildApp()).delete('/api/ai/prompts/nope');
    expect(res.status).toBe(404);
  });
});
