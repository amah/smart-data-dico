/**
 * #sql-settings — the ai.sql config turns into a system-prompt instruction.
 */
import { sqlSettingsInstruction } from '../aiController.js';

describe('sqlSettingsInstruction', () => {
  it('returns empty when the setting is off / absent', () => {
    expect(sqlSettingsInstruction(undefined)).toBe('');
    expect(sqlSettingsInstruction(null)).toBe('');
    expect(sqlSettingsInstruction({})).toBe('');
    expect(sqlSettingsInstruction({ sql: { schemaQualifyTables: false } })).toBe('');
  });

  it('instructs to schema-qualify, and asks for a schema when no default is set', () => {
    const t = sqlSettingsInstruction({ sql: { schemaQualifyTables: true } });
    expect(t).toMatch(/schema-qualify table names/i);
    expect(t).toMatch(/"schema\.table"/);
    expect(t).toMatch(/ask the user which schema/i);
  });

  it('names the default schema when one is configured', () => {
    const t = sqlSettingsInstruction({ sql: { schemaQualifyTables: true, defaultSchema: 'commerce' } });
    expect(t).toMatch(/default schema "commerce"/);
    expect(t).not.toMatch(/ask the user/i);
  });
});
