/**
 * DiagramViewTabs — the Structural/Physical tab strip shown above a diagram
 * canvas. Shared by the standalone /diagram page and the package Diagram view
 * so both render the same switcher; the caller owns the selected mode (URL
 * and/or sticky preference).
 */
import { VIEW_MODES, VIEW_MODE_LABELS, type ViewMode } from './viewMode';

interface DiagramViewTabsProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const DiagramViewTabs = ({ value, onChange }: DiagramViewTabsProps) => (
  <div
    role="tablist"
    aria-label="Diagram view mode"
    style={{
      display: 'flex',
      gap: 0,
      padding: '0 8px',
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderBottom: 0,
      borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
    }}
  >
    {VIEW_MODES.map((m) => {
      const isActive = value === m;
      return (
        <button
          key={m}
          role="tab"
          aria-selected={isActive}
          onClick={() => onChange(m)}
          style={{
            padding: '8px 12px',
            background: 'transparent',
            border: 'none',
            borderBottom: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
            color: isActive ? 'var(--text)' : 'var(--text-muted)',
            fontSize: 'var(--fs-sm)',
            fontWeight: isActive ? 600 : 400,
            marginBottom: -1,
            cursor: 'pointer',
          }}
        >
          {VIEW_MODE_LABELS[m]}
        </button>
      );
    })}
  </div>
);

export default DiagramViewTabs;
