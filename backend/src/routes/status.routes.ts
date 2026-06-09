import { Router } from 'express';

const router: Router = Router();
router.get('/api/status', (req, res) => {
  const profile = process.env.PROFILE || 'local';
  res.json({
    status: 'operational',
    mode: profile === 'local' ? 'desktop' : 'server',
    profile,
    version: process.env.SDD_VERSION || process.env.npm_package_version || 'dev',
    auth: profile === 'local' ? 'none' : 'jwt',
  });
});
export default router;
