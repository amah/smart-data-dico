import { useEffect, useMemo, useState } from 'react';
import { searchApi, type SearchIndexHealth } from '../services/api';

const REFRESH_MS = 30_000;

function statusTitle(status: SearchIndexHealth | null | undefined): string {
  if (status === undefined) return 'Checking full-text search index status';
  if (status === null) return 'Search index status could not be retrieved from the backend';

  const parts = [
    status.ready ? 'Search index ready' : 'Search index unavailable',
    `${status.documentCount.toLocaleString()} documents`,
    `${status.indexedRootPackages.toLocaleString()} root packages`,
  ];
  const kinds = Object.entries(status.countsByKind)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, count]) => `${kind}: ${count.toLocaleString()}`);
  if (kinds.length > 0) parts.push(kinds.join(', '));
  if (status.lastBuildAt) parts.push(`built ${new Date(status.lastBuildAt).toLocaleString()}`);
  if (status.lastBuildError) parts.push(`error: ${status.lastBuildError}`);
  parts.push(status.nodeVersion);
  return parts.join(' · ');
}

export default function SearchIndexStatus() {
  const [status, setStatus] = useState<SearchIndexHealth | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      // Attach both handlers immediately. Besides avoiding an unhandled promise
      // window, this keeps the interval callback strictly synchronous.
      searchApi.getStatus().then(
        (next) => {
          if (active) setStatus(next);
        },
        () => {
          if (active) setStatus(null);
        },
      );
    };
    refresh();
    const interval = window.setInterval(refresh, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const view = useMemo(() => {
    if (status === undefined) return { label: 'Checking index…', dot: 'bg-warning animate-pulse' };
    if (status === null) return { label: 'Index status unknown', dot: 'bg-base-content/30' };
    if (status.ready) return {
      label: `Index ${status.documentCount.toLocaleString()} docs`,
      dot: 'bg-success',
    };
    if (status.lastBuildError) return { label: 'Index unavailable', dot: 'bg-error' };
    return { label: 'Indexing…', dot: 'bg-warning animate-pulse' };
  }, [status]);

  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-base-content/70"
      role="status"
      aria-live="polite"
      title={statusTitle(status)}
      data-testid="search-index-status"
    >
      <span className={`h-2 w-2 rounded-full ${view.dot}`} aria-hidden="true" />
      {view.label}
    </span>
  );
}
