/**
 * dicoConfigDomain.test.ts (#TBD) — value-domain rules on derived types.
 *
 * Covers the per-kind validation (enum / codelist / reference) added to
 * validateDerivedTypes, and resolveDomain's chain walk. All functions are pure,
 * so no storage mock is needed.
 */
import {
  validateDerivedTypes,
  validateDomain,
  resolveDomain,
  validateHideRules,
  validateElementStyles,
  validateStyleRules,
  type DerivedType,
  type HideRule,
  type ElementStyle,
  type StyleRule,
} from '../dicoConfigService.js';

describe('validateElementStyles', () => {
  it('accepts valid styles', () => {
    const styles: ElementStyle[] = [
      { name: 'aggregate-root', label: 'Aggregate Root', border: 'primary', borderWidth: 4, emphasis: true },
      { name: 'junction', shape: 'hexagon', opacity: 0.7 },
    ];
    expect(validateElementStyles(styles)).toEqual([]);
  });
  it('rejects a non-kebab name', () => {
    expect(validateElementStyles([{ name: 'Aggregate Root' }])[0]).toMatch(/kebab/);
  });
  it('rejects duplicate names', () => {
    expect(validateElementStyles([{ name: 'a' }, { name: 'a' }]).some((e) => /duplicate/.test(e))).toBe(true);
  });
  it('rejects a bad borderStyle and out-of-range opacity', () => {
    const errs = validateElementStyles([{ name: 'x', borderStyle: 'wavy' as ElementStyle['borderStyle'], opacity: 2 }]);
    expect(errs.some((e) => /borderStyle/.test(e))).toBe(true);
    expect(errs.some((e) => /opacity/.test(e))).toBe(true);
  });
});

describe('validateStyleRules', () => {
  it('accepts valid rules referencing known styles', () => {
    const rules: StyleRule[] = [
      { match: 'stereotype', pattern: 'aggregate-root', style: 'aggregate-root' },
      { match: 'physicalTableName', pattern: '*_link', style: 'junction' },
    ];
    expect(validateStyleRules(rules, ['aggregate-root', 'junction'])).toEqual([]);
  });
  it('rejects an unknown match kind', () => {
    expect(validateStyleRules([{ match: 'nope' as StyleRule['match'], pattern: 'x', style: 'junction' }], ['junction'])[0]).toMatch(/match must be/);
  });
  it('rejects a rule whose style is not defined', () => {
    expect(validateStyleRules([{ match: 'role', pattern: 'junction', style: 'ghost' }], ['junction'])[0]).toMatch(/not a defined element style/);
  });
  it('rejects an invalid regex', () => {
    expect(validateStyleRules([{ match: 'entityName', pattern: '(', regex: true, style: 'junction' }], ['junction'])[0]).toMatch(/invalid regex/);
  });
});

describe('validateHideRules', () => {
  it('accepts valid glob and regex rules', () => {
    const rules: HideRule[] = [
      { match: 'physicalTableName', pattern: '*_bak' },
      { match: 'entityName', pattern: 'Tmp*', reason: 'temp' },
      { match: 'physicalTableName', pattern: '_[0-9]{8}$', regex: true },
    ];
    expect(validateHideRules(rules)).toEqual([]);
  });
  it('rejects an unknown match kind', () => {
    expect(validateHideRules([{ match: 'nope' as HideRule['match'], pattern: 'x' }])[0]).toMatch(/match must be/);
  });
  it('rejects an empty pattern', () => {
    expect(validateHideRules([{ match: 'entityName', pattern: '' }])[0]).toMatch(/pattern is required/);
  });
  it('rejects an invalid regex', () => {
    expect(validateHideRules([{ match: 'entityName', pattern: '(', regex: true }])[0]).toMatch(/invalid regex/);
  });
});

describe('validateDomain', () => {
  it('enum requires values and forbids a source', () => {
    expect(validateDomain('s', { kind: 'enum', values: ['A', 'B'] })).toEqual([]);
    expect(validateDomain('s', { kind: 'enum', values: [] })).toEqual([
      expect.stringContaining('must list at least one value'),
    ]);
    expect(validateDomain('s', { kind: 'enum', values: ['A'], source: 'x' })).toEqual([
      expect.stringContaining('must not declare a `source`'),
    ]);
  });

  it('codelist requires a source (values optional)', () => {
    expect(validateDomain('c', { kind: 'codelist', source: 'ISO-4217' })).toEqual([]);
    expect(validateDomain('c', { kind: 'codelist', source: 'ISO-4217', values: ['USD'] })).toEqual([]);
    expect(validateDomain('c', { kind: 'codelist' })).toEqual([
      expect.stringContaining('must declare a `source`'),
    ]);
  });

  it('reference requires a source and forbids inline values', () => {
    expect(validateDomain('r', { kind: 'reference', source: 'geo/Country' })).toEqual([]);
    expect(validateDomain('r', { kind: 'reference' })).toEqual([
      expect.stringContaining('must declare a `source`'),
    ]);
    expect(validateDomain('r', { kind: 'reference', source: 'geo/Country', values: ['FR'] })).toEqual([
      expect.stringContaining('must not carry inline `values`'),
    ]);
  });

  it('rejects an unknown kind', () => {
    expect(validateDomain('x', { kind: 'bogus' as never })).toEqual([
      expect.stringContaining('invalid domain kind'),
    ]);
  });
});

describe('validateDerivedTypes surfaces domain errors', () => {
  it('flags a reference type missing its source', () => {
    const types: DerivedType[] = [
      { name: 'country-ref', basedOn: 'string', domain: { kind: 'reference' } },
    ];
    expect(validateDerivedTypes(types)).toEqual([
      expect.stringContaining('must declare a `source`'),
    ]);
  });

  it('accepts a well-formed enum/codelist/reference trio', () => {
    const types: DerivedType[] = [
      { name: 'order-status', basedOn: 'string', domain: { kind: 'enum', values: ['NEW', 'DONE'] } },
      { name: 'currency', basedOn: 'string', domain: { kind: 'codelist', source: 'ISO-4217', values: ['USD'] } },
      { name: 'country-ref', basedOn: 'string', domain: { kind: 'reference', source: 'geo/Country' } },
    ];
    expect(validateDerivedTypes(types)).toEqual([]);
  });
});

describe('resolveDomain', () => {
  const types: DerivedType[] = [
    { name: 'order-status', basedOn: 'string', domain: { kind: 'enum', values: ['NEW'] } },
    { name: 'currency', basedOn: 'string', domain: { kind: 'codelist', source: 'ISO-4217' } },
    { name: 'pref-currency', basedOn: 'currency' }, // inherits via chain
    { name: 'plain', basedOn: 'string' },
  ];

  it('returns the domain of a domain-bearing type', () => {
    expect(resolveDomain('order-status', types)).toEqual({ kind: 'enum', values: ['NEW'] });
  });

  it('walks the chain to the nearest domain', () => {
    expect(resolveDomain('pref-currency', types)).toEqual({ kind: 'codelist', source: 'ISO-4217' });
  });

  it('returns null for standard, unknown, or domainless types', () => {
    expect(resolveDomain('string', types)).toBeNull();
    expect(resolveDomain('plain', types)).toBeNull();
    expect(resolveDomain('nope', types)).toBeNull();
  });
});
