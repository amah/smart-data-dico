/**
 * Design-system primitives (Phase 2).
 *
 * Import from `@/components/ui`.
 */

export { default as Chip } from './Chip';
export type { ChipProps, ChipTone } from './Chip';

export { default as TypeChip } from './TypeChip';
export type { TypeChipProps } from './TypeChip';

export { default as PiiChip } from './PiiChip';
export type { PiiChipProps } from './PiiChip';

export { default as StatusChip } from './StatusChip';
export type { StatusChipProps, StatusValue } from './StatusChip';

export {
  CategoryKindChip,
  RelationshipKindChip,
} from './KindChip';
export type {
  CategoryKind,
  CategoryKindChipProps,
  RelationshipKind,
  RelationshipKindChipProps,
} from './KindChip';

export { default as Icon } from './Icon';
export type { IconName, IconProps } from './Icon';

export { default as Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { default as Input } from './Input';
export type { InputProps, InputSize } from './Input';

export { default as DensitySwitcher } from './DensitySwitcher';
export type { Density, DensitySwitcherProps } from './DensitySwitcher';

export { default as Toolbar } from './Toolbar';
export type { ToolbarProps } from './Toolbar';

export { default as Menu } from './Menu';
export type { MenuProps } from './Menu';

export { default as DataTable } from './DataTable';
export type { DataTableProps } from './DataTable';
export type { ColumnDef, ColumnGroup, SortDir } from './DataTable.types';

export { default as ColumnChooser } from './ColumnChooser';
export type { ColumnChooserProps } from './ColumnChooser';

export { default as BatchActionBar } from './BatchActionBar';
export type { BatchActionBarProps, BatchAction } from './BatchActionBar';
