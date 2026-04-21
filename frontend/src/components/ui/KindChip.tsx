/**
 * KindChip — category badges for the Integrity page and relationships.
 *
 *   V / C / R  — single-letter category initials, outlined in category color
 *                (Validation = info, Constraint = warning, Rule = accent)
 *   embedded / reference — relationship kinds; accent for embedded, neutral
 *                for reference.
 *
 * Source: design_handoff README §7 (Integrity) and §4 (Relationships).
 */

import Chip, { type ChipTone } from './Chip';

export type CategoryKind = 'validation' | 'constraint' | 'rule';
export type RelationshipKind = 'embedded' | 'reference';

const CATEGORY_TONES: Record<CategoryKind, ChipTone> = {
  validation: 'info',
  constraint: 'warning',
  rule:       'accent',
};

const CATEGORY_INITIAL: Record<CategoryKind, string> = {
  validation: 'V',
  constraint: 'C',
  rule:       'R',
};

const CATEGORY_LABEL: Record<CategoryKind, string> = {
  validation: 'Validation',
  constraint: 'Constraint',
  rule:       'Rule',
};

const RELATIONSHIP_TONES: Record<RelationshipKind, ChipTone> = {
  embedded:  'accent',
  reference: 'neutral',
};

export interface CategoryKindChipProps {
  kind: CategoryKind;
  /** Show the single-letter initial (V/C/R). Defaults to full label. */
  initialOnly?: boolean;
  className?: string;
}

export const CategoryKindChip = ({ kind, initialOnly, className }: CategoryKindChipProps) => (
  <Chip
    tone={CATEGORY_TONES[kind]}
    mono={initialOnly}
    className={className}
    title={initialOnly ? CATEGORY_LABEL[kind] : undefined}
  >
    {initialOnly ? CATEGORY_INITIAL[kind] : CATEGORY_LABEL[kind]}
  </Chip>
);

export interface RelationshipKindChipProps {
  kind: RelationshipKind;
  className?: string;
}

export const RelationshipKindChip = ({ kind, className }: RelationshipKindChipProps) => (
  <Chip tone={RELATIONSHIP_TONES[kind]} soft className={className}>
    {kind}
  </Chip>
);
