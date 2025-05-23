import { randomUUID } from 'crypto';

/**
 * Generates a UUID v4
 * @returns A new UUID string
 */
export function generateUUID(): string {
  return randomUUID();
}

/**
 * Validates if a string is a valid UUID
 * @param uuid String to validate
 * @returns True if valid UUID
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Generates a human-readable filename using UUID and name
 * @param uuid The UUID of the entity
 * @param name The name of the entity
 * @returns A filename in format: uuid_name.yaml
 */
export function generateEntityFilename(uuid: string, name: string): string {
  // Sanitize name for filename (remove special characters, replace spaces with underscores)
  const sanitizedName = name.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
  return `${uuid}_${sanitizedName}.yaml`;
}

/**
 * Extracts UUID from a filename
 * @param filename The filename to extract UUID from
 * @returns The UUID or null if not found
 */
export function extractUUIDFromFilename(filename: string): string | null {
  const match = filename.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i);
  return match ? match[1] : null;
}