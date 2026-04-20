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
 * Generates a canonical entity filename from its name (#105).
 * Format: `<Name>.entity.yaml`. The UUID prefix of the legacy format
 * (`<uuid>_<Name>.yaml`) is dropped — name uniqueness within a package
 * is enforced at the service layer instead.
 *
 * Sanitization: reject `/ \ : * .` and leading `.`; collapse whitespace
 * to single underscores. Case is preserved.
 */
export function generateEntityFilename(_uuid: string, name: string): string {
  const sanitized = sanitizeFsName(name);
  return `${sanitized}.entity.yaml`;
}

/**
 * Normalize a name for use as a filename / folder name. Strips characters
 * that would break paths on any common filesystem, plus a leading dot
 * (reserved for system files such as `.dico/`).
 */
export function sanitizeFsName(name: string): string {
  const trimmed = name.trim().replace(/^\.+/, '');
  return trimmed
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_');
}