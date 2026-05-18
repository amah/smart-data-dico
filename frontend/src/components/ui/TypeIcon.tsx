/**
 * TypeIcon — a compact, icon-only badge for an attribute type, used as a
 * decorator on the entity-table name cell when the dedicated "Type"
 * column is hidden. The full type name lives in the title (tooltip) so
 * the affordance survives keyboard / screen-reader users.
 *
 * Unknown types (including derived types like `email`, `url`) fall
 * through to a neutral "T" glyph + the raw type name in the tooltip —
 * the user still sees what type it is via hover, just without a
 * dedicated mark.
 *
 * The full-text TypeChip remains the right choice when the column is
 * shown, the diagram tooltip, or anywhere horizontal space is plentiful.
 */

import Chip, { type ChipTone } from './Chip';

interface TypeGlyph {
  glyph: string;
  tone: ChipTone;
  soft?: boolean;
  dashed?: boolean;
}

// Glyphs picked for cross-platform font coverage: ASCII, Greek `Δ`,
// math `≡`, basic-Unicode `→`. Emoji-style glyphs (⌚, ⏱, ▦, ⬡) were
// tried first but rendered as tofu on stock system fonts — avoid.
const TYPE_GLYPHS: Record<string, TypeGlyph> = {
  string:      { glyph: 'Aa',  tone: 'neutral' },
  number:      { glyph: '#',   tone: 'neutral' },
  integer:     { glyph: '#',   tone: 'neutral' },
  decimal:     { glyph: '#',   tone: 'neutral' },
  boolean:     { glyph: 'T/F', tone: 'neutral' },
  datetime:    { glyph: 'dt',  tone: 'neutral' },
  'date-time': { glyph: 'dt',  tone: 'neutral' },
  date:        { glyph: 'd',   tone: 'neutral' },
  time:        { glyph: 't',   tone: 'neutral' },
  timestamp:   { glyph: 'ts',  tone: 'neutral' },
  duration:    { glyph: 'Δt',  tone: 'neutral' },
  enum:        { glyph: '≡',   tone: 'accent', soft: true },
  object:      { glyph: '{}',  tone: 'neutral', dashed: true },
  array:       { glyph: '[]',  tone: 'neutral', dashed: true },
  uuid:        { glyph: 'id',  tone: 'neutral' },
  ref:         { glyph: '→',   tone: 'accent', soft: true },
};

const FALLBACK: TypeGlyph = { glyph: 'T', tone: 'neutral' };

export interface TypeIconProps {
  type: string;
  /** Override tooltip — default is the raw type name. */
  title?: string;
  className?: string;
}

const TypeIcon = ({ type, title, className }: TypeIconProps) => {
  const v = TYPE_GLYPHS[type] ?? FALLBACK;
  return (
    <Chip
      mono
      tone={v.tone}
      dashed={v.dashed}
      soft={v.soft}
      title={title ?? `Type: ${type}`}
      className={className}
    >
      {v.glyph}
    </Chip>
  );
};

export default TypeIcon;
