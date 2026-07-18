import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SearchIndexStatus from '../SearchIndexStatus';
import { searchApi, type SearchIndexHealth } from '../../services/api';

vi.mock('../../services/api', () => ({
  searchApi: { getStatus: vi.fn() },
}));

const getStatus = vi.mocked(searchApi.getStatus);

const healthy: SearchIndexHealth = {
  ready: true,
  documentCount: 3155,
  countsByKind: { entity: 300, attribute: 2700, package: 155 },
  indexedRootPackages: 42,
  lastBuildAt: '2026-07-17T10:00:00.000Z',
  lastBuildError: null,
  nodeVersion: 'v24.18.0',
};

describe('SearchIndexStatus', () => {
  beforeEach(() => getStatus.mockReset());

  it('shows indexed document count and detailed health when ready', async () => {
    getStatus.mockResolvedValue(healthy);
    render(<SearchIndexStatus />);

    const indicator = await screen.findByText('Index 3,155 docs');
    expect(indicator.closest('[role="status"]')).toHaveAttribute('title', expect.stringContaining('42 root packages'));
    expect(indicator.closest('[role="status"]')).toHaveAttribute('title', expect.stringContaining('attribute: 2,700'));
  });

  it('shows the backend build failure', async () => {
    getStatus.mockResolvedValue({ ...healthy, ready: false, documentCount: 0, lastBuildError: 'FTS5 unavailable' });
    render(<SearchIndexStatus />);

    const indicator = await screen.findByText('Index unavailable');
    expect(indicator.closest('[role="status"]')).toHaveAttribute('title', expect.stringContaining('FTS5 unavailable'));
  });

});
