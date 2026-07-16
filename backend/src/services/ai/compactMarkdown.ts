/** Compact, deterministic Markdown for AI tool results. */

export type AgentOutputFormat = 'markdown' | 'json';

const text = (value: unknown): string => String(value ?? '')
  .replace(/\r?\n/g, '<br>')
  .replace(/\|/g, '\\|');

const code = (value: unknown): string => value == null || value === ''
  ? '—'
  : `\`${String(value).replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').replace(/`/g, '\\`')}\``;

const compactJson = (value: unknown): string => {
  if (value == null) return '—';
  const serialized = JSON.stringify(value);
  return serialized === '{}' || serialized === '[]' ? '—' : code(serialized);
};

export function entityDetailsToMarkdown(details: Record<string, any>): string {
  if (details.error) return `> Error: ${text(details.error)}`;
  if (details.ambiguous) {
    const rows = (details.candidates ?? []).map((candidate: any) =>
      `| ${code(candidate.entityName)} | ${code(candidate.packageName)} | ${text(candidate.description) || '—'} |`);
    return [
      `# Ambiguous entity: ${code(details.candidates?.[0]?.entityName ?? 'unknown')}`,
      '',
      '| Entity | Package | Description |',
      '|---|---|---|',
      ...rows,
      '',
      `> ${text(details.note)}`,
    ].join('\n');
  }

  const physical = details.physical as { schema?: string; tableName?: string } | undefined;
  const attrs = (details.attributes ?? []).map((attribute: any) => {
    const flags = [attribute.primaryKey ? 'PK' : '', attribute.required ? 'required' : 'optional']
      .filter(Boolean).join(', ');
    const mapping = attribute.physical
      ? [attribute.physical.columnName, attribute.physical.dbType].filter(Boolean).join(' : ')
      : '—';
    return `| ${code(attribute.name)} | ${code(attribute.type)} | ${flags} | ${text(mapping)} | ${compactJson(attribute.validation)} | ${text(attribute.description) || '—'} |`;
  });
  const lines = [
    `# ${text(details.name)}${details.packageName ? ` — ${code(details.packageName)}` : ''}`,
    '',
    text(details.description) || '_No description._',
  ];
  if (details.stereotype) lines.push('', `Stereotype: ${code(details.stereotype)}`);
  if (physical) {
    const qualified = [physical.schema, physical.tableName].filter(Boolean).join('.');
    lines.push('', `Physical table: ${code(qualified)}`);
  }
  lines.push(
    '',
    `## Attributes (${attrs.length})`,
    '',
    '| Attribute | Type | Flags | Physical column/type | Validation | Description |',
    '|---|---|---|---|---|---|',
    ...(attrs.length ? attrs : ['| — | — | — | — | — | — |']),
  );
  if (details.constraints?.length) {
    lines.push('', '## Constraints', '', ...details.constraints.map((constraint: unknown) => `- ${compactJson(constraint)}`));
  }
  if (details.rules?.length) {
    lines.push('', '## Rules', '', ...details.rules.map((rule: any) =>
      `- **${text(rule.name)}**${rule.severity ? ` [${text(rule.severity)}]` : ''}${rule.description ? `: ${text(rule.description)}` : ''}`));
  }
  return lines.join('\n');
}

export function sqlSchemaToMarkdown(schema: Record<string, any>): string {
  if (schema.error) return `> Error: ${text(schema.error)}`;
  const lines = [
    '# Physical SQL schema',
    '',
    `Dialect: ${code(schema.dialect)}  `,
    `Scope: ${text(schema.scope)}`,
  ];
  for (const table of schema.tables ?? []) {
    lines.push(
      '',
      `## ${text(table.entity)} — ${code(table.qualifiedName ?? table.table)}`,
      '',
      `Package: ${code(table.package)}`,
      '',
      '| Attribute | Column | DB type | Flags |',
      '|---|---|---|---|',
      ...(table.columns?.length ? table.columns.map((column: any) => {
        const flags = [column.primaryKey ? 'PK' : '', column.nullable ? 'nullable' : 'required', column.physicalMappingMissing ? 'derived mapping' : '']
          .filter(Boolean).join(', ');
        return `| ${code(column.attribute)} | ${code(column.column)} | ${code(column.dbType)} | ${flags} |`;
      }) : ['| — | — | — | — |']),
    );
  }
  if (schema.relationships?.length) {
    lines.push('', '## Relationships', '', '| From | Cardinality | To | Cardinality | Description |', '|---|---|---|---|---|');
    lines.push(...schema.relationships.map((relationship: any) =>
      `| ${code(relationship.from)} | ${text(relationship.fromCardinality)} | ${code(relationship.to)} | ${text(relationship.toCardinality)} | ${text(relationship.description) || '—'} |`));
  }
  if (schema.unresolvedEntityNames?.length) {
    lines.push('', `> Unresolved entities: ${schema.unresolvedEntityNames.map(code).join(', ')}`);
  }
  if (schema.note) lines.push('', `> ${text(schema.note)}`);
  return lines.join('\n');
}
