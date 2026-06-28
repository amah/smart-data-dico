import { assertReadOnlySelect, SqlGuardError, stripCommentsAndLiterals } from '../sqlGuards.js';

const ok = (sql: string) => expect(() => assertReadOnlySelect(sql)).not.toThrow();
const bad = (sql: string) => expect(() => assertReadOnlySelect(sql)).toThrow(SqlGuardError);

describe('assertReadOnlySelect', () => {
  it('allows plain SELECT, with trailing semicolon, and leading parens/CTE', () => {
    ok('SELECT * FROM orders');
    ok('select id, total from orders where total > 0;');
    ok('  (SELECT 1)  ');
    ok('WITH recent AS (SELECT * FROM orders WHERE created_at > now() - interval \'30 days\') SELECT * FROM recent');
    ok('SELECT * FROM t WHERE name = \'DROP TABLE x;\''); // forbidden words only inside a literal
  });

  it('rejects writes / DDL / multi-statement / procedural', () => {
    for (const sql of [
      'INSERT INTO orders VALUES (1)',
      'UPDATE orders SET total = 0',
      'DELETE FROM orders',
      'DROP TABLE orders',
      'TRUNCATE orders',
      'CREATE TABLE x (id int)',
      'ALTER TABLE orders ADD c int',
      'GRANT SELECT ON orders TO bob',
      'CALL do_thing()',
      'SELECT 1; DROP TABLE orders', // sneaky second statement
      'SELECT 1; SELECT 2',
      'SET search_path = evil',
      'WITH x AS (DELETE FROM orders RETURNING *) SELECT * FROM x', // data-modifying CTE
      '',
      '   ',
    ]) {
      bad(sql);
    }
  });

  it('is not fooled by comments hiding a second statement', () => {
    bad('SELECT 1 -- harmless\n; DROP TABLE orders');
    ok('SELECT 1 -- ; this semicolon is in a comment\n');
    ok('SELECT 1 /* ; block comment ; */ FROM orders');
  });
});

describe('stripCommentsAndLiterals', () => {
  it('blanks comments and literal bodies but keeps structure', () => {
    expect(stripCommentsAndLiterals("SELECT 'a;b' -- x\n, 1")).not.toContain('-- x');
    // the ';' inside the string literal is blanked out, so it is not seen as a separator
    expect(stripCommentsAndLiterals("SELECT 'a;b'")).not.toMatch(/;/);
  });
});
