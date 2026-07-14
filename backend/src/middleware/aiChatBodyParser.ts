import express from 'express';

export const DEFAULT_AI_CHAT_BODY_LIMIT = '2mb';

/**
 * AI chat carries accumulated conversation and page context, which can exceed
 * Express's default 100 KB JSON limit. Keep the larger allowance scoped to the
 * chat routes rather than widening every JSON endpoint.
 */
export function createAiChatBodyParser() {
  return express.json({
    limit: process.env.AI_CHAT_BODY_LIMIT || DEFAULT_AI_CHAT_BODY_LIMIT,
  });
}
