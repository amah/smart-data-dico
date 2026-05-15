import { Router } from 'express';

const router: Router = Router();
// Deferred-import IIFE preserves the existing graceful-degradation behavior:
// if @hamak/* or AI deps fail to import (optional feature), boot continues
// and AI routes 404 until the import resolves. Pattern lifted verbatim from
// the current god-file lines 345-371.
(async () => {
  try {
    const chatRoutes = (await import('./chat.routes.js')).default;
    const conversationRoutes = (await import('./conversation.routes.js')).default;
    const promptRoutes = (await import('./prompt.routes.js')).default;
    router.use(chatRoutes);
    router.use(conversationRoutes);
    router.use(promptRoutes);
  } catch {
    // AI dependencies not available (optional feature)
  }
})();
export default router;
