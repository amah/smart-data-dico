/**
 * PageHeader — the shared one-row header for detail/landing pages.
 *
 * Grammar: breadcrumb (flex 1) → expand-chevron (if description) → meta →
 * tabs → actions (right). Description, when provided, is collapsed by
 * default; clicking the chevron next to the breadcrumb toggles it. The
 * expanded/collapsed choice is persisted (sticky across navigation and
 * reload, shared by every page that renders a PageHeader).
 */

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useStoredState } from '../../hooks/useStoredState';

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

/**
 * Shared sticky expanded/collapsed preference for page descriptions.
 * One toggle governs every page: PageHeader's own chevron and pages that
 * render their own (VisualizationPage) read and write the same key.
 */
export function useDescriptionExpanded(): [boolean, () => void] {
  const [stored, setStored] = useStoredState(
    'sdd-desc-expanded',
    'collapsed',
    (raw): raw is 'expanded' | 'collapsed' => raw === 'expanded' || raw === 'collapsed',
  );
  const isExpanded = stored === 'expanded';
  const toggle = () => setStored(isExpanded ? 'collapsed' : 'expanded');
  return [isExpanded, toggle];
}

export interface PageHeaderProps {
  breadcrumb: ReactNode;
  meta?: ReactNode;
  tabs?: ReactNode;
  actions?: ReactNode;
  description?: string;
  className?: string;
}

const PageHeader = ({
  breadcrumb,
  meta,
  tabs,
  actions,
  description,
  className = '',
}: PageHeaderProps) => {
  const [isExpanded, toggleExpanded] = useDescriptionExpanded();

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>{breadcrumb}</div>
          {description && (
            <button
              type="button"
              onClick={toggleExpanded}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Hide description' : 'Show description'}
              title={isExpanded ? 'Hide description' : 'Show description'}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 2,
                margin: 0,
                cursor: 'pointer',
                color: 'var(--text-subtle)',
                display: 'inline-flex',
                alignItems: 'center',
                borderRadius: 4,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="currentColor"
                style={{
                  transition: 'transform 150ms ease',
                  transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
          {meta && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              {meta}
            </div>
          )}
        </div>
        {tabs && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {tabs}
          </div>
        )}
        {actions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {actions}
          </div>
        )}
      </div>
      {description && isExpanded && (
        <div
          style={{
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-muted)',
            lineHeight: 1.4,
            paddingLeft: 2,
          }}
        >
          {description}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
