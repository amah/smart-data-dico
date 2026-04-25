/**
 * PageHeader — the shared one-row header for detail/landing pages.
 *
 * Grammar: breadcrumb (flex 1) → meta (chips/badges) → actions (right).
 * Optional `description` renders as a thin subtle line below; truncated to
 * one line by default and expanded on click.
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

// Module-level subscription so <Layout> can hide its global breadcrumb
// while a <PageHeader> is mounted (avoiding the duplicate-breadcrumb stack).
let mountCount = 0;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
const getSnapshot = () => mountCount;
export const usePageHeaderMounted = () =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot) > 0;

export interface PageHeaderProps {
  breadcrumb: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  description?: string;
  className?: string;
}

const PageHeader = ({
  breadcrumb,
  meta,
  actions,
  description,
  className = '',
}: PageHeaderProps) => {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    mountCount++;
    listeners.forEach(cb => cb());
    return () => {
      mountCount--;
      listeners.forEach(cb => cb());
    };
  }, []);

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 32 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>{breadcrumb}</div>
          {meta && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {meta}
            </div>
          )}
        </div>
        {actions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>
      {description && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          title={expanded ? 'Collapse' : 'Expand'}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            margin: 0,
            textAlign: 'left',
            cursor: 'pointer',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-subtle)',
            lineHeight: 1.4,
            ...(expanded
              ? { whiteSpace: 'normal' as const }
              : {
                  whiteSpace: 'nowrap' as const,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }),
          }}
        >
          {description}
        </button>
      )}
    </div>
  );
};

export default PageHeader;
