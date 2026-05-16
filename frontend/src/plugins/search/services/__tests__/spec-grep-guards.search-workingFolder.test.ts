/**
 * #154 — content-guard regressions for `workingFolder` factory option
 * and the dynamic-file search pattern.
 *
 * Coverage map:
 *   #154-A  createSearchPlugin accepts SearchPluginOptions with workingFolder?.
 *   #154-B  searchPlugin.ts exports SearchResultFileContent and SearchCommandResult.
 *   #154-C  searchPlugin.ts command body uses actions.setFile (not setFileContent).
 *   #154-D  bootstrap.ts no longer imports searchSlice / registers search reducer.
 *   #154-E  createDataDictionaryPlugin accepts DataDictionaryPluginOptions.
 *   #154-F  createVisualizationPlugin accepts VisualizationPluginOptions.
 *   #154-G  SearchComponent uses storeFs.createFileSelector (not useState<SearchResult[]>).
 *   #154-H  commands.ts search.search output is SearchCommandResult (not SearchResponse).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const HERE = __dirname;
// `frontend/src/plugins/search/services/__tests__` is 6 levels under repo root
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..', '..');
const SRC = path.join(REPO_ROOT, 'frontend', 'src');

const SEARCH_PLUGIN = path.join(SRC, 'plugins', 'search', 'searchPlugin.ts');
const DATA_DICTIONARY_PLUGIN = path.join(SRC, 'plugins', 'data-dictionary', 'dataDictionaryPlugin.ts');
const VISUALIZATION_PLUGIN = path.join(SRC, 'plugins', 'visualization', 'visualizationPlugin.ts');
const AI_PLUGIN = path.join(SRC, 'plugins', 'ai-assistance', 'aiPlugin.ts');
const BOOTSTRAP = path.join(SRC, 'kernel', 'bootstrap.ts');
const COMMANDS_TS = path.join(SRC, 'kernel', 'commands.ts');
const SEARCH_COMPONENT = path.join(SRC, 'components', 'SearchComponent.tsx');
const SEARCH_SLICE = path.join(SRC, 'store', 'slices', 'searchSlice.ts');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

// ── #154-A — SearchPluginOptions with workingFolder ───────────────────────

describe('#154 acceptance — createSearchPlugin accepts workingFolder option', () => {
  it('searchPlugin.ts exports SearchPluginOptions interface', () => {
    const content = read(SEARCH_PLUGIN);
    expect(content).toMatch(/export interface SearchPluginOptions\b/);
  });

  it('SearchPluginOptions has workingFolder?: string[] field', () => {
    const content = read(SEARCH_PLUGIN);
    expect(content).toMatch(/workingFolder\?\s*:\s*string\[\]/);
  });

  it('createSearchPlugin accepts optional options parameter', () => {
    const content = read(SEARCH_PLUGIN);
    expect(content).toMatch(/export function createSearchPlugin\s*\(\s*options/);
  });
});

// ── #154-B — SearchResultFileContent and SearchCommandResult exported ─────

describe('#154 acceptance — search plugin exports dynamic-file types', () => {
  it('searchPlugin.ts exports SearchResultFileContent', () => {
    const content = read(SEARCH_PLUGIN);
    expect(content).toMatch(/export interface SearchResultFileContent\b/);
  });

  it('searchPlugin.ts exports SearchCommandResult', () => {
    const content = read(SEARCH_PLUGIN);
    expect(content).toMatch(/export interface SearchCommandResult\b/);
  });

  it('SearchCommandResult has path: string[] and response fields', () => {
    const content = read(SEARCH_PLUGIN);
    expect(content).toMatch(/path\s*:\s*string\[\]/);
    expect(content).toMatch(/response\s*:\s*SearchResponse/);
  });
});

// ── #154-C — command body uses setFile, NOT setFileContent ────────────────

describe('#154 acceptance — search command body uses setFile not setFileContent', () => {
  it('searchPlugin.ts command body calls actions.setFile(', () => {
    const content = read(SEARCH_PLUGIN);
    expect(content).toMatch(/actions\.setFile\s*\(/);
  });

  it('searchPlugin.ts does NOT call actions.setFileContent( (would trigger autosave)', () => {
    const content = read(SEARCH_PLUGIN);
    // setFileContent triggers autosave-middleware; we must use setFile instead.
    expect(content).not.toMatch(/actions\.setFileContent\s*\(/);
  });

  it('searchPlugin.ts writes search-<id>.json filename pattern', () => {
    const content = read(SEARCH_PLUGIN);
    expect(content).toMatch(/`search-\$\{.*\}\.json`/);
  });
});

// ── #154-D — bootstrap.ts clean of searchSlice ───────────────────────────

describe('#154 acceptance — bootstrap.ts has no searchSlice import or reducer registration', () => {
  it('searchSlice.ts does not exist', () => {
    expect(fs.existsSync(SEARCH_SLICE)).toBe(false);
  });

  it('bootstrap.ts does not import searchSlice', () => {
    const content = read(BOOTSTRAP);
    expect(content).not.toMatch(/searchSlice/);
    expect(content).not.toMatch(/searchReducer/);
  });

  it('bootstrap.ts has no reducerRegistry.register for search', () => {
    const content = read(BOOTSTRAP);
    // Check for register('search', ...) pattern
    expect(content).not.toMatch(/reducerRegistry\.register\s*\(\s*['"]search['"]/);
  });

  it('bootstrap.ts search plugin registration includes store-fs in dependsOn', () => {
    const content = read(BOOTSTRAP);
    // The search plugin must depend on store-fs so STORE_FS_TOKEN is available
    expect(content).toMatch(/['"]search['"]\s*,\s*\{[^}]*dependsOn[^}]*'store-fs'/);
  });
});

// ── #154-E — DataDictionaryPluginOptions with workingFolder ──────────────

describe('#154 acceptance — createDataDictionaryPlugin accepts workingFolder option', () => {
  it('dataDictionaryPlugin.ts exports DataDictionaryPluginOptions interface', () => {
    const content = read(DATA_DICTIONARY_PLUGIN);
    expect(content).toMatch(/export interface DataDictionaryPluginOptions\b/);
  });

  it('DataDictionaryPluginOptions has workingFolder?: string[] field', () => {
    const content = read(DATA_DICTIONARY_PLUGIN);
    expect(content).toMatch(/workingFolder\?\s*:\s*string\[\]/);
  });
});

// ── #154-F — VisualizationPluginOptions with workingFolder ───────────────

describe('#154 acceptance — createVisualizationPlugin accepts workingFolder option', () => {
  it('visualizationPlugin.ts exports VisualizationPluginOptions interface', () => {
    const content = read(VISUALIZATION_PLUGIN);
    expect(content).toMatch(/export interface VisualizationPluginOptions\b/);
  });

  it('VisualizationPluginOptions has workingFolder?: string[] field', () => {
    const content = read(VISUALIZATION_PLUGIN);
    expect(content).toMatch(/workingFolder\?\s*:\s*string\[\]/);
  });
});

// ── AiPluginOptions with workingFolder ────────────────────────────────────

describe('#154 acceptance — createAiAssistancePlugin accepts workingFolder option', () => {
  it('aiPlugin.ts exists', () => {
    expect(fs.existsSync(AI_PLUGIN)).toBe(true);
  });

  it('aiPlugin.ts exports AiPluginOptions interface', () => {
    const content = read(AI_PLUGIN);
    expect(content).toMatch(/export interface AiPluginOptions\b/);
  });

  it('AiPluginOptions has workingFolder?: string[] field', () => {
    const content = read(AI_PLUGIN);
    expect(content).toMatch(/workingFolder\?\s*:\s*string\[\]/);
  });
});

// ── #154-G — SearchComponent uses createFileSelector not useState<SearchResult[]> ──

describe('#154 acceptance — SearchComponent reads results via Store FS selector', () => {
  it('SearchComponent.tsx does NOT contain useState<SearchResult[]>', () => {
    const content = read(SEARCH_COMPONENT);
    expect(content).not.toMatch(/useState\s*<\s*SearchResult\s*\[\]\s*>/);
  });

  it('SearchComponent.tsx calls storeFs.createFileSelector', () => {
    const content = read(SEARCH_COMPONENT);
    expect(content).toMatch(/storeFs\.createFileSelector\s*\(/);
  });

  it('SearchComponent.tsx imports STORE_FS_TOKEN', () => {
    const content = read(SEARCH_COMPONENT);
    expect(content).toMatch(/STORE_FS_TOKEN/);
  });

  it('SearchComponent.tsx uses useState<string[] | null> for currentPath', () => {
    const content = read(SEARCH_COMPONENT);
    expect(content).toMatch(/useState\s*<\s*string\s*\[\]\s*\|\s*null\s*>/);
  });
});

// ── #154-H — commands.ts search.search output is SearchCommandResult ──────

describe('#154 acceptance — CommandMap search.search output type is SearchCommandResult', () => {
  it('commands.ts imports SearchCommandResult (not SearchResponse) for search.search', () => {
    const content = read(COMMANDS_TS);
    expect(content).toMatch(/SearchCommandResult/);
  });

  it('commands.ts search.search output uses SearchCommandResult', () => {
    const content = read(COMMANDS_TS);
    // Find the search.search block — it spans multiple lines, use [\s\S] to match newlines.
    const searchBlock = content.match(/'search\.search'\s*:\s*\{[\s\S]*?output\s*:[\s\S]*?\}/)?.[0] ?? '';
    expect(searchBlock).toContain('SearchCommandResult');
  });
});
