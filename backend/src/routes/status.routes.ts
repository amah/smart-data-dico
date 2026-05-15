import { Router } from 'express';

const router: Router = Router();
router.get('/api/status', (req, res) => {
  const profile = process.env.PROFILE || 'local';
  res.json({
    status: 'operational',
    mode: profile === 'local' ? 'desktop' : 'server',
    profile,
    version: process.env.npm_package_version || '1.1.1',
    auth: profile === 'local' ? 'none' : 'jwt',
  });
});
export default router;
