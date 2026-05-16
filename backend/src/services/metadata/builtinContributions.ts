import type { MetadataValue, MetadataDefinition } from '../../models/EntitySchema.js';
import type {
  MetadataTypeContributionCore,
  MetadataTypeRegistryBackend,
  MetadataValidationResult,
  JsonSchemaFragment,
} from './MetadataTypeRegistry.js';
import { metadataValueToSearchString } from './metadataValueToSearchString.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ok(): MetadataValidationResult {
  return { ok: true, errors: [] };
}

function fail(path: string, message: string): MetadataValidationResult {
  return { ok: false, errors: [{ path, message }] };
}

function identity<T extends MetadataValue>(v: T): MetadataValue {
  return v;
}

// ─── String ──────────────────────────────────────────────────────────────────

export const builtinStringContribution: MetadataTypeContributionCore<string> = {
  type: 'string',
  label: 'Text',
  defaultValue: '',
  validate(value): MetadataValidationResult {
    if (typeof value !== 'string') return fail('', `Expected string, got ${typeof value}`);
    return ok();
  },
  serialize: identity,
  parse(raw): string { return raw === undefined || raw === null ? '' : String(raw); },
  toJsonSchema(_def: MetadataDefinition): JsonSchemaFragment {
    return { type: 'string' };
  },
  toMarkdown(value: string): string { return value; },
};

// ─── Number ──────────────────────────────────────────────────────────────────

export const builtinNumberContribution: MetadataTypeContributionCore<number> = {
  type: 'number',
  label: 'Number',
  defaultValue: 0,
  validate(value): MetadataValidationResult {
    if (typeof value !== 'number') return fail('', `Expected number, got ${typeof value}`);
    return ok();
  },
  serialize: identity,
  parse(raw): number {
    const n = Number(raw);
    return isNaN(n) ? 0 : n;
  },
  toJsonSchema(_def: MetadataDefinition): JsonSchemaFragment {
    return { type: 'number' };
  },
  toMarkdown(value: number): string { return String(value); },
};

// ─── Boolean ─────────────────────────────────────────────────────────────────

export const builtinBooleanContribution: MetadataTypeContributionCore<boolean> = {
  type: 'boolean',
  label: 'Boolean',
  defaultValue: false,
  validate(value): MetadataValidationResult {
    if (typeof value !== 'boolean') return fail('', `Expected boolean, got ${typeof value}`);
    return ok();
  },
  serialize: identity,
  parse(raw): boolean { return !!raw; },
  toJsonSchema(_def: MetadataDefinition): JsonSchemaFragment {
    return { type: 'boolean' };
  },
  toMarkdown(value: boolean): string { return String(value); },
};

// ─── Date ────────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const builtinDateContribution: MetadataTypeContributionCore<string> = {
  type: 'date',
  label: 'Date',
  defaultValue: '',
  validate(value): MetadataValidationResult {
    if (typeof value !== 'string') return fail('', `Expected ISO date string, got ${typeof value}`);
    if (value !== '' && !ISO_DATE_RE.test(value)) {
      return fail('', `Expected ISO date (YYYY-MM-DD), got '${value}'`);
    }
    return ok();
  },
  serialize: identity,
  parse(raw): string { return raw === undefined || raw === null ? '' : String(raw); },
  toJsonSchema(_def: MetadataDefinition): JsonSchemaFragment {
    return { type: 'string', format: 'date' };
  },
  toMarkdown(value: string): string { return value; },
};

// ─── Flag ────────────────────────────────────────────────────────────────────

export const builtinFlagContribution: MetadataTypeContributionCore<boolean> = {
  type: 'flag',
  label: 'Flag',
  defaultValue: false,
  validate(value): MetadataValidationResult {
    if (typeof value !== 'boolean') return fail('', `Expected boolean flag, got ${typeof value}`);
    return ok();
  },
  serialize: identity,
  parse(raw): boolean { return !!raw; },
  toJsonSchema(_def: MetadataDefinition): JsonSchemaFragment {
    return { type: 'boolean' };
  },
  toMarkdown(value: boolean): string { return value ? 'true' : 'false'; },
};

// ─── Rule ────────────────────────────────────────────────────────────────────

export const builtinRuleContribution: MetadataTypeContributionCore<string> = {
  type: 'rule',
  label: 'Rule',
  defaultValue: '',
  validate(value): MetadataValidationResult {
    if (typeof value !== 'string') return fail('', `Expected rule text string, got ${typeof value}`);
    return ok();
  },
  serialize: identity,
  parse(raw): string { return raw === undefined || raw === null ? '' : String(raw); },
  toJsonSchema(_def: MetadataDefinition): JsonSchemaFragment {
    return { type: 'string' };
  },
  toMarkdown(value: string): string { return value; },
};

// ─── Object ──────────────────────────────────────────────────────────────────

export const builtinObjectContribution: MetadataTypeContributionCore<{ [k: string]: MetadataValue }> = {
  type: 'object',
  label: 'Object',
  defaultValue: {},
  validate(value, def: MetadataDefinition): ReturnType<typeof ok> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return fail('', `Expected object, got ${Array.isArray(value) ? 'array' : typeof value}`);
    }
    const errors: Array<{ path: string; message: string }> = [];
    if (def.fields) {
      for (const fieldDef of def.fields) {
        const fieldVal = (value as Record<string, MetadataValue>)[fieldDef.name];
        if (fieldDef.required && (fieldVal === undefined || fieldVal === '' || fieldVal === null)) {
          errors.push({ path: fieldDef.name, message: `Required field '${fieldDef.name}' is missing` });
          continue;
        }
        if (fieldVal !== undefined) {
          // Inline recursive validation placeholder — the registry is seeded
          // after this module is imported, so we use a lazy import pattern.
          // The full validation is exercised via validateBlock in the registry.
        }
      }
    }
    if (errors.length > 0) return { ok: false, errors };
    return ok();
  },
  serialize: identity as (v: { [k: string]: MetadataValue }) => MetadataValue,
  parse(raw): { [k: string]: MetadataValue } {
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      return raw as { [k: string]: MetadataValue };
    }
    return {};
  },
  toJsonSchema(def: MetadataDefinition): JsonSchemaFragment {
    const schema: JsonSchemaFragment = { type: 'object' };
    if (def.fields && def.fields.length > 0) {
      schema.properties = {};
      const required: string[] = [];
      // Lazy registry resolution for nested types — we inline basic handling
      // here; the full recursive export goes through the registry in exportService.
      for (const f of def.fields) {
        schema.properties[f.name] = { type: 'string', description: f.description };
        if (f.required) required.push(f.name);
      }
      if (required.length > 0) schema.required = required;
    }
    return schema;
  },
  toMarkdown(value: { [k: string]: MetadataValue }, _def?: MetadataDefinition): string {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      lines.push(`  - ${k}: ${metadataValueToSearchString(v)}`);
    }
    return lines.join('\n');
  },
};

// ─── Array ───────────────────────────────────────────────────────────────────

export const builtinArrayContribution: MetadataTypeContributionCore<MetadataValue[]> = {
  type: 'array',
  label: 'Array',
  defaultValue: [],
  validate(value): MetadataValidationResult {
    if (!Array.isArray(value)) return fail('', `Expected array, got ${typeof value}`);
    return ok();
  },
  serialize: identity as (v: MetadataValue[]) => MetadataValue,
  parse(raw): MetadataValue[] {
    if (Array.isArray(raw)) return raw as MetadataValue[];
    return [];
  },
  toJsonSchema(def: MetadataDefinition): JsonSchemaFragment {
    const schema: JsonSchemaFragment = { type: 'array' };
    if (def.items) {
      schema.items = { type: 'object', description: def.items.description };
    }
    return schema;
  },
  toMarkdown(value: MetadataValue[], _def?: MetadataDefinition): string {
    return value.map((item, i) => `    ${i + 1}. ${metadataValueToSearchString(item)}`).join('\n');
  },
};

// ─── Enum ────────────────────────────────────────────────────────────────────

export const builtinEnumContribution: MetadataTypeContributionCore<string | number> = {
  type: 'enum',
  label: 'Enum',
  defaultValue: '',
  validate(value, def: MetadataDefinition): MetadataValidationResult {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return fail('', `Expected string or number for enum, got ${typeof value}`);
    }
    if (def.enum && def.enum.length > 0) {
      const allowed = def.enum.map((e) =>
        typeof e === 'object' ? e.value : e,
      );
      if (!allowed.includes(value)) {
        return fail('', `Value '${value}' is not one of the allowed enum values`);
      }
    }
    return ok();
  },
  serialize: identity as (v: string | number) => MetadataValue,
  parse(raw): string | number {
    if (typeof raw === 'number') return raw;
    return raw === undefined || raw === null ? '' : String(raw);
  },
  toJsonSchema(def: MetadataDefinition): JsonSchemaFragment {
    const schema: JsonSchemaFragment = { type: 'string' };
    if (def.enum && def.enum.length > 0) {
      schema.enum = def.enum.map((e) => (typeof e === 'object' ? e.value : e));
    }
    return schema;
  },
  toMarkdown(value: string | number): string { return String(value); },
};

// ─── Registration helper ─────────────────────────────────────────────────────

export function registerBuiltinContributions(r: MetadataTypeRegistryBackend): void {
  r.register(builtinStringContribution);
  r.register(builtinNumberContribution);
  r.register(builtinBooleanContribution);
  r.register(builtinDateContribution);
  r.register(builtinFlagContribution);
  r.register(builtinRuleContribution);
  r.register(builtinObjectContribution);
  r.register(builtinArrayContribution);
  r.register(builtinEnumContribution);
}
