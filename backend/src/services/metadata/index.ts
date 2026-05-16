/**
 * Metadata type registry — backend module entry point.
 * Importing this module seeds the singleton registry with all 9 built-in
 * contributions as a side-effect.
 */
export { metadataTypeRegistry, createMetadataTypeRegistry } from './MetadataTypeRegistry.js';
export type {
  MetadataTypeContributionCore,
  MetadataTypeRegistryBackend,
  MetadataValidationError,
  MetadataValidationResult,
  JsonSchemaFragment,
} from './MetadataTypeRegistry.js';
export { registerBuiltinContributions } from './builtinContributions.js';
export { metadataValueToSearchString } from './metadataValueToSearchString.js';

import { metadataTypeRegistry } from './MetadataTypeRegistry.js';
import { registerBuiltinContributions } from './builtinContributions.js';

// Seed the singleton with built-ins on module load.
registerBuiltinContributions(metadataTypeRegistry);
