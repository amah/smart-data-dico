/**
 * TypeChip — renders an attribute type identifier (string, uuid, enum, …)
 * in the mono font with tone mapped to the type family. Ported from
 * design_handoff/primitives.jsx TYPE_STYLES.
 *
 * Unknown types (e.g. derived types like `email`, `url`) fall through
 * to the neutral mono style so they still render consistently.
 */

import Chip, { type ChipTone } from './Chip';

type TypeVariant = {
  tone: ChipTone;
  dashed?: boolean;
  soft?: boolean;
};

const TYPE_VARIANTS: Record<string, TypeVariant> = {
  string:   { tone: 'neutral' },
  number:   { tone: 'neutral' },
  integer:  { tone: 'neutral' },
  decimal:  { tone: 'neutral' },
  boolean:  { tone: 'neutral' },
  datetime: { tone: 'neutral' },
  date:     { tone: 'neutral' },
  uuid:     { tone: 'neutral' },
  enum:     { tone: 'accent', soft: true },
  ref:      { tone: 'accent', soft: true },
  object:   { tone: 'neutral', dashed: true },
  array:    { tone: 'neutral', dashed: true },
};

export interface TypeChipProps {
  type: string;
  title?: string;
  className?: string;
}

const TypeChip = ({ type, title, className }: TypeChipProps) => {
  const v = TYPE_VARIANTS[type] ?? { tone: 'neutral' as const };
  return (
    <Chip
      mono
      tone={v.tone}
      dashed={v.dashed}
      soft={v.soft}
      title={title}
      className={className}
    >
      {type}
    </Chip>
  );
};

export default TypeChip;
