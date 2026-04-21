/**
 * PiiChip — PII classification indicator.
 *
 * Visual: colored dot + label in the PII color, no chip bg. Matches
 * design_handoff/primitives.jsx PiiChip — intentionally quieter than
 * StatusChip because PII repeats on nearly every row.
 *
 * null / undefined → em-dash in text-subtle.
 */

type PiiValue = 'direct' | 'indirect' | 'possible' | null | undefined;

const PII: Record<Exclude<PiiValue, null | undefined>, { label: string; varName: string }> = {
  direct:   { label: 'Direct',   varName: '--pii-direct' },
  indirect: { label: 'Indirect', varName: '--pii-indirect' },
  possible: { label: 'Possible', varName: '--pii-possible' },
};

export interface PiiChipProps {
  value: PiiValue;
  className?: string;
}

const PiiChip = ({ value, className }: PiiChipProps) => {
  if (!value) {
    return (
      <span style={{ color: 'var(--text-subtle)' }} className={className}>
        —
      </span>
    );
  }
  const s = PII[value];
  return (
    <span
      className={`inline-flex items-center gap-1 text-token-xs font-medium ${className ?? ''}`}
      style={{ color: `var(${s.varName})` }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 9999,
          background: `var(${s.varName})`,
          flexShrink: 0,
        }}
      />
      {s.label}
    </span>
  );
};

export default PiiChip;
