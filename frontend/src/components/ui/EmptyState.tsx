/**
 * EmptyState — unified slot for loading / error / empty states.
 *
 * Three `kind`s share a single visual frame so the tables feel
 * coherent whether the API is still loading, failed, or returned no
 * rows. `attached` pairs with a Toolbar above: top border and corners
 * are flattened so the frame reads as a continuation of the toolbar.
 * `inline` drops the frame entirely — useful when embedding inside a
 * DataTable's `emptyMessage` slot, which already supplies its own
 * container.
 */

import type { ReactNode } from 'react';
import Button from './Button';
import Icon, { type IconName } from './Icon';

export type EmptyStateKind = 'loading' | 'error' | 'empty';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: IconName;
}

export interface EmptyStateProps {
  kind?: EmptyStateKind;
  /** Custom icon override; each kind has a sensible default. */
  icon?: IconName;
  title?: string;
  message?: ReactNode;
  action?: EmptyStateAction;
  /** Pairs with a Toolbar above — removes the top border/corners. */
  attached?: boolean;
  /** Inline mode: no container chrome (for DataTable emptyMessage slot). */
  inline?: boolean;
}

const DEFAULT_ICON: Record<EmptyStateKind, IconName> = {
  loading: 'layers', // unused — loading renders the spinner instead
  error: 'warning',
  empty: 'layers',
};

const EmptyState = ({
  kind = 'empty',
  icon,
  title,
  message,
  action,
  attached,
  inline,
}: EmptyStateProps) => {
  const iconName = icon ?? DEFAULT_ICON[kind];
  const isError = kind === 'error';
  const isLoading = kind === 'loading';

  const frame: React.CSSProperties = inline
    ? { padding: '24px 16px', textAlign: 'center' }
    : {
        padding: 32,
        background: isError ? 'var(--danger-soft)' : 'var(--bg-raised)',
        border: `1px solid ${isError ? 'var(--danger)' : 'var(--border)'}`,
        borderTop: attached ? 0 : undefined,
        borderRadius: attached
          ? '0 0 var(--radius-md) var(--radius-md)'
          : 'var(--radius-md)',
        textAlign: 'center',
        color: isError ? 'var(--danger)' : 'var(--text-muted)',
      };

  return (
    <div role={isError ? 'alert' : 'status'} style={frame}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {isLoading ? (
          <span
            className="loading loading-spinner loading-md"
            aria-hidden="true"
          />
        ) : (
          <Icon
            name={iconName}
            size={24}
            style={{
              color: isError ? 'var(--danger)' : 'var(--text-subtle)',
            }}
          />
        )}
        {title && (
          <div
            style={{
              fontSize: 'var(--fs-md)',
              fontWeight: 600,
              color: isError ? 'var(--danger)' : 'var(--text)',
            }}
          >
            {title}
          </div>
        )}
        {message && (
          <div
            style={{
              fontSize: 'var(--fs-sm)',
              color: isError ? 'var(--danger)' : 'var(--text-muted)',
              maxWidth: 420,
            }}
          >
            {message}
          </div>
        )}
        {action && (
          <div style={{ marginTop: 4 }}>
            <Button
              size="sm"
              variant={isError ? 'danger' : 'secondary'}
              icon={action.icon}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default EmptyState;
