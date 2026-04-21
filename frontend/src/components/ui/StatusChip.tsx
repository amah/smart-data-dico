/**
 * StatusChip — pass/fail/drift + breaking/major/minor/info.
 *
 * Drift is first-class amber per the Integrity spec (design_handoff
 * README §7). Severity for the Model Diff uses the same component,
 * so we keep the tone mapping in one place.
 *
 * Soft-filled by default (*-soft bg + solid-color text) to match the
 * README's chip grammar.
 */

import Chip, { type ChipTone } from './Chip';

export type StatusValue =
  // Integrity statuses
  | 'pass' | 'fail' | 'drift'
  // Severity levels (integrity + diff)
  | 'blocker' | 'error' | 'warning' | 'info'
  // Diff kinds
  | 'breaking' | 'major' | 'minor';

const STATUS_TONES: Record<StatusValue, ChipTone> = {
  pass:     'success',
  fail:     'danger',
  drift:    'warning',

  blocker:  'danger',
  error:    'danger',
  warning:  'warning',
  info:     'info',

  breaking: 'danger',
  major:    'warning',
  minor:    'info',
};

const STATUS_LABELS: Partial<Record<StatusValue, string>> = {
  pass: 'Pass',
  fail: 'Fail',
  drift: 'Drift',
  blocker: 'Blocker',
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
  breaking: 'Breaking',
  major: 'Major',
  minor: 'Minor',
};

export interface StatusChipProps {
  value: StatusValue;
  /** Override the default label. */
  label?: string;
  /** Switch to outlined (transparent bg + colored border). Defaults to soft fill. */
  outlined?: boolean;
  className?: string;
}

const StatusChip = ({ value, label, outlined, className }: StatusChipProps) => (
  <Chip
    tone={STATUS_TONES[value]}
    soft={!outlined}
    className={className}
  >
    {label ?? STATUS_LABELS[value] ?? value}
  </Chip>
);

export default StatusChip;
