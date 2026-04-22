/**
 * ColumnChooser — dropdown that toggles column visibility, grouped
 * by Standard / Governance metadata. Intended to live on a Toolbar.
 *
 * The chooser itself is stateless w.r.t. the column list; callers
 * pass the column registry and the current visibility Set, then
 * react to onChange.
 */

import Button from './Button';
import Menu from './Menu';
import type { ColumnDef, ColumnGroup } from './DataTable.types';

export interface ColumnChooserProps {
  columns: ColumnDef<unknown>[];
  visible: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Label on the trigger button. */
  label?: string;
}

const GROUP_LABEL: Record<ColumnGroup, string> = {
  standard: 'Standard',
  metadata: 'Governance metadata',
};

const ColumnChooser = ({ columns, visible, onChange, label = 'Columns…' }: ColumnChooserProps) => {
  const toggle = (key: string) => {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  const groups: ColumnGroup[] = ['standard', 'metadata'];

  return (
    <Menu
      align="start"
      width={260}
      trigger={({ toggle: toggleOpen, open }) => (
        <Button variant="ghost" size="md" icon="columns" pressed={open} onClick={toggleOpen}>
          {label}
        </Button>
      )}
    >
      <div>
        {groups.map(group => {
          const groupCols = columns.filter(c => (c.group ?? 'standard') === group);
          if (groupCols.length === 0) return null;
          return (
            <div key={group}>
              <div
                className="uppercase"
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: group === 'metadata' ? 'var(--meta-label)' : 'var(--text-subtle)',
                  letterSpacing: '0.06em',
                  padding: '8px 8px 4px',
                  fontWeight: 600,
                }}
              >
                {GROUP_LABEL[group]}
              </div>
              {groupCols.map(col => {
                const checked = visible.has(col.key);
                return (
                  <button
                    key={col.key}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={checked}
                    onClick={() => toggle(col.key)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      textAlign: 'left',
                      padding: '5px 8px',
                      fontSize: 'var(--fs-sm)',
                      color: 'var(--text)',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
                        background: checked ? 'var(--accent)' : 'transparent',
                        color: 'var(--accent-fg)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {checked && (
                        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                          <path d="m5 12 5 5L20 7" />
                        </svg>
                      )}
                    </span>
                    <span style={{ flex: 1 }}>{col.header}</span>
                    {col.mono && (
                      <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-subtle)' }}>
                        mono
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </Menu>
  );
};

export default ColumnChooser;
