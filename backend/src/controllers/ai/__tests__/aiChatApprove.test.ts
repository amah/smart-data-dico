/**
 * Supertest coverage for POST /api/ai/chat/approve (the aiChatApprove
 * controller). Mirrors the mounting style of
 * `backend/src/routes/__tests__/mcp.routes.test.ts`: build a tiny express
 * app, mount the controller, and drive it with supertest.
 *
 * The controller settles a pending entry in the shared approvalRegistry,
 * so each test registers a waiter with `awaitApproval` from the SAME
 * module instance the controller imports, then asserts the awaiting
 * promise resolves with the posted decision.
 *
 * Acceptance criteria 10–12.
 */

import express, { type Express } from 'express';
import request from 'supertest';

import { aiChatApprove } from '../../aiController';
import { awaitApproval } from '../approvalRegistry';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.post('/api/ai/chat/approve', aiChatApprove);
  return app;
}

describe('POST /api/ai/chat/approve — aiChatApprove', () => {
  // AC10: a pending approval present → 200 {ok:true} and the waiter resolves.
  it('returns 200 {ok:true} and resolves the awaiting promise on a pending entry', async () => {
    const streamId = 'stream-10';
    const toolCallId = 'call-10';
    const waiter = awaitApproval(streamId, toolCallId);

    const res = await request(buildApp())
      .post('/api/ai/chat/approve')
      .send({ streamId, toolCallId, decision: 'approve' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    await expect(waiter).resolves.toBe('approve');
  });

  it('forwards a "deny" decision to the awaiting promise', async () => {
    const streamId = 'stream-10b';
    const toolCallId = 'call-10b';
    const waiter = awaitApproval(streamId, toolCallId);

    const res = await request(buildApp())
      .post('/api/ai/chat/approve')
      .send({ streamId, toolCallId, decision: 'deny' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    await expect(waiter).resolves.toBe('deny');
  });

  // AC11: no pending entry → 404 {ok:false}.
  it('returns 404 {ok:false} when no approval is pending', async () => {
    const res = await request(buildApp())
      .post('/api/ai/chat/approve')
      .send({ streamId: 'ghost', toolCallId: 'ghost', decision: 'approve' });

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  // AC12: invalid decision → 400.
  it('returns 400 for an invalid decision value', async () => {
    // Register a real waiter so a 400 cannot be excused as "nothing pending".
    awaitApproval('stream-12', 'call-12');

    const res = await request(buildApp())
      .post('/api/ai/chat/approve')
      .send({ streamId: 'stream-12', toolCallId: 'call-12', decision: 'maybe' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 when streamId or toolCallId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/ai/chat/approve')
      .send({ decision: 'approve' });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
