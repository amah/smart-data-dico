/**
 * Read-only guard for the "run generated SQL" feature. Generated SQL is run
 * against a real database, so we hard-enforce SELECT-only semantics: a single
 * statement that can only read. This is a defence-in-depth gate in front of the
 * read-only transaction the executors also open — if either fails, nothing
 * mutates.
 */

export class SqlGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlGuardError';
  }
}

/** Statements/keywords that can write or change state — rejected outright. */
const FORBIDDEN_LEADING = new Set([
  'insert', 'update', 'delete', 'merge', 'upsert', 'replace',
  'create', 'alter', 'drop', 'truncate', 'rename', 'comment',
  'grant', 'revoke', 'call', 'exec', 'execute', 'do', 'set',
  'begin', 'commit', 'rollback', 'savepoint', 'use', 'copy', 'vacuum',
  'analyze', 'lock', 'reindex', 'cluster', 'refresh', 'attach', 'detach',
]);

/**
 * Strip SQL comments (line `--` and block) and string/identifier literals so
 * the structural checks below see only code. Literals are blanked (not removed)
 * so positions/`;` outside literals are still detectable. Best-effort: it errs
 * toward treating ambiguous input as code, which only makes the guard stricter.
 */
export function stripCommentsAndLiterals(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const c2 = sql[i + 1];
    // line comment
    if (c === '-' && c2 === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    // block comment
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    // single/double-quoted literal or backtick identifier — blank the body
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += quote;
      i++;
      while (i < n) {
        if (sql[i] === quote && sql[i + 1] === quote) { i += 2; continue; } // escaped quote
        if (sql[i] === quote) break;
        i++;
      }
      out += quote;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Assert that `sql` is a single read-only SELECT. Throws SqlGuardError otherwise.
 * Allows leading CTEs (`WITH …`) and a parenthesised leading `(SELECT …)`.
 */
export function assertReadOnlySelect(sql: string): void {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new SqlGuardError('No SQL provided.');
  }
  const stripped = stripCommentsAndLiterals(sql);

  // single statement only — a trailing ';' is fine, an interior one is not.
  const withoutTrailing = stripped.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    throw new SqlGuardError('Only a single statement may be run. Remove extra ";"-separated statements.');
  }

  const trimmed = withoutTrailing.trim().replace(/^\(+\s*/, '');
  const firstWord = (trimmed.match(/^([a-zA-Z]+)/)?.[1] || '').toLowerCase();

  if (firstWord === 'with') {
    // A CTE is read-only ONLY if it has no data-modifying CTE bodies.
    if (/\b(insert|update|delete|merge)\b/i.test(stripped)) {
      throw new SqlGuardError('Data-modifying statements are not allowed — only read-only SELECT queries can be run.');
    }
    return;
  }
  if (firstWord === 'select') return;

  if (FORBIDDEN_LEADING.has(firstWord)) {
    throw new SqlGuardError(`"${firstWord.toUpperCase()}" is not allowed — only read-only SELECT queries can be run.`);
  }
  throw new SqlGuardError('Only read-only SELECT queries (optionally with leading WITH/CTE) can be run.');
}
