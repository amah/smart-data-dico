import express from 'express';
import request from 'supertest';
import { createAiChatBodyParser } from '../aiChatBodyParser.js';

describe('createAiChatBodyParser', () => {
  it('accepts AI chat JSON payloads larger than the Express default limit', async () => {
    const app = express();
    app.use('/api/ai/chat', createAiChatBodyParser());
    app.use(express.json());
    app.post('/api/ai/chat', (req, res) => res.json({ length: req.body.content.length }));

    const content = 'x'.repeat(150 * 1024);
    const response = await request(app)
      .post('/api/ai/chat')
      .send({ content });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ length: content.length });
  });

  it('honours AI_CHAT_BODY_LIMIT when configured', async () => {
    const previous = process.env.AI_CHAT_BODY_LIMIT;
    process.env.AI_CHAT_BODY_LIMIT = '1kb';

    try {
      const app = express();
      app.use('/api/ai/chat', createAiChatBodyParser());
      app.post('/api/ai/chat', (_req, res) => res.sendStatus(204));

      const response = await request(app)
        .post('/api/ai/chat')
        .send({ content: 'x'.repeat(2 * 1024) });

      expect(response.status).toBe(413);
    } finally {
      if (previous === undefined) delete process.env.AI_CHAT_BODY_LIMIT;
      else process.env.AI_CHAT_BODY_LIMIT = previous;
    }
  });
});
