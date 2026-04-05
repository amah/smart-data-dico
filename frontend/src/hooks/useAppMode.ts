import { useState, useEffect } from 'react';

interface AppStatus {
  mode: 'desktop' | 'server';
  profile: string;
  auth: 'none' | 'jwt';
  version: string;
}

const defaultStatus: AppStatus = {
  mode: 'desktop',
  profile: 'local',
  auth: 'none',
  version: '',
};

let cachedStatus: AppStatus | null = null;

export function useAppMode(): AppStatus {
  const [status, setStatus] = useState<AppStatus>(cachedStatus || defaultStatus);

  useEffect(() => {
    if (cachedStatus) return;
    fetch('/api/status')
      .then(r => r.json())
      .then(d => {
        const s: AppStatus = {
          mode: d.mode || 'desktop',
          profile: d.profile || 'local',
          auth: d.auth || 'none',
          version: d.version || '',
        };
        cachedStatus = s;
        setStatus(s);

        // In desktop mode, ensure auth token is set for API calls
        if (s.mode === 'desktop') {
          localStorage.setItem('auth_token', 'mock-token-for-testing');
          localStorage.setItem('auth_user', JSON.stringify({ id: '1', username: 'admin', role: 'admin' }));
        }
      })
      .catch(() => {});
  }, []);

  return status;
}

export function isDesktopMode(): boolean {
  return cachedStatus?.mode === 'desktop' || (cachedStatus === null);
}
