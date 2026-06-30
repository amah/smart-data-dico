/**
 * Settings-section contribution slot.
 *
 * Lets a plugin add its own section to the Settings page WITHOUT editing
 * Settings.tsx. Plugins register a self-contained component at import time; the
 * Settings page renders whatever is registered. Keeps feature config with the
 * feature.
 */
import type { ComponentType } from 'react';

const sections: ComponentType[] = [];

/** Register a Settings section component (idempotent by reference). */
export function registerSettingsSection(component: ComponentType): void {
  if (!sections.includes(component)) sections.push(component);
}

export function getSettingsSections(): ComponentType[] {
  return sections;
}
