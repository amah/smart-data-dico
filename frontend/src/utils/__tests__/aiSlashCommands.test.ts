/**
 * Pure-fn coverage for the slash-command catalog and helpers (#56).
 * The component-level integration test (AIChatPanel.slash.test.tsx)
 * exercises the picker → expansion → input handoff; this suite locks
 * down the building blocks (token extraction, ranking, template
 * substitution, help renderer) so regressions are caught at unit speed.
 */
import { describe, it, expect } from 'vitest';
import {
  SLASH_COMMANDS,
  buildHelpMessage,
  expandTemplate,
  extractSlashToken,
  filterSlashCommands,
} from '../aiSlashCommands';

describe('extractSlashToken', () => {
  it('returns the empty string for a bare leading slash', () => {
    expect(extractSlashToken('/')).toBe('');
  });

  it('returns the partial command name', () => {
    expect(extractSlashToken('/hel')).toBe('hel');
    expect(extractSlashToken('/quality')).toBe('quality');
  });

  it('returns null when there is no leading slash', () => {
    expect(extractSlashToken('hello')).toBeNull();
    expect(extractSlashToken('')).toBeNull();
  });

  it('returns null for mid-line slashes — they are paths, not commands', () => {
    expect(extractSlashToken('see /packages/foo')).toBeNull();
    expect(extractSlashToken(' /list')).toBeNull();
  });

  it('rejects whitespace after the partial token (already a complete word)', () => {
    expect(extractSlashToken('/list ')).toBeNull();
    expect(extractSlashToken('/help me')).toBeNull();
  });
});

describe('filterSlashCommands', () => {
  it('returns every command for the empty token (just `/`)', () => {
    const out = filterSlashCommands('');
    expect(out).toHaveLength(SLASH_COMMANDS.length);
  });

  it('prefix-ranks before substring matches', () => {
    const out = filterSlashCommands('e');
    // `export` starts with e → comes before `relate` (substring match)
    const names = out.map(c => c.name);
    expect(names.indexOf('export')).toBeLessThan(names.indexOf('relate'));
  });

  it('exact match wins over prefix match', () => {
    const out = filterSlashCommands('list');
    expect(out[0].name).toBe('list');
  });

  it('returns no commands for a token that matches nothing', () => {
    expect(filterSlashCommands('xyz')).toHaveLength(0);
  });

  it('is case-insensitive', () => {
    expect(filterSlashCommands('HELP').map(c => c.name)).toContain('help');
  });
});

describe('expandTemplate', () => {
  it('passes through templates without placeholders', () => {
    expect(expandTemplate('static text')).toBe('static text');
  });

  it('weaves the page context into a {pageContext} placeholder', () => {
    const out = expandTemplate('Run a quality review {pageContext}.', 'Currently viewing entity Order in package order-service.');
    expect(out).toContain('order-service');
    expect(out).not.toContain('{pageContext}');
  });

  it('drops the placeholder cleanly when no page context is provided', () => {
    const out = expandTemplate('Run a quality review {pageContext}.');
    expect(out).toBe('Run a quality review.');
  });

  it('also drops the placeholder when the page context is whitespace only', () => {
    const out = expandTemplate('Describe {pageContext}.', '   ');
    expect(out).toBe('Describe.');
  });
});

describe('buildHelpMessage', () => {
  it('lists every registered command in the help message', () => {
    const msg = buildHelpMessage();
    SLASH_COMMANDS.forEach(cmd => {
      expect(msg).toContain(`/${cmd.name}`);
      expect(msg).toContain(cmd.description);
    });
  });
});
