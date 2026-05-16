/**
 * #56 — Built-in slash commands for the AI chat composer.
 *
 * Slash commands are essentially built-in saved prompts (#123) with a
 * shorter trigger. Typing `/` at the start of the composer opens a
 * palette; selecting a command replaces `/<cmd>` with the templated
 * prompt body. The user can still edit the expansion before sending.
 *
 * `template` may reference `{pageContext}` to weave in the current
 * "Currently viewing …" sentence (#58). Unrecognized placeholders are
 * left as literal text so a future placeholder is forward-compatible.
 *
 * Command kinds:
 *   - `prompt`  → expansion is sent to the AI like any user turn
 *   - `local`   → expansion is shown client-side without contacting AI
 *                 (currently used by `/help` to render the catalog)
 */
export interface SlashCommand {
  name: string;
  description: string;
  template: string;
  kind: 'prompt' | 'local';
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: 'help',
    description: 'Show available slash commands',
    template: '',
    kind: 'local',
  },
  {
    name: 'list',
    description: 'List all packages and entity counts',
    template: 'List every package and the number of entities in each.',
    kind: 'prompt',
  },
  {
    name: 'diagram',
    description: 'Open the organization diagram',
    template: 'Take me to the organization diagram view.',
    kind: 'prompt',
  },
  {
    name: 'quality',
    description: 'Quality review of the current package',
    template:
      'Run a quality review {pageContext}. Surface concerns: missing primary keys, undocumented attributes, inconsistent naming, orphaned entities, ambiguous types. Group findings by severity (high / medium / low) and recommend specific edits.',
    kind: 'prompt',
  },
  {
    name: 'describe',
    description: 'Describe the current entity in detail',
    template:
      'Describe in detail the entity {pageContext}. Include its purpose, attributes (name, type, required, primary key), stereotype, and any relationships you can infer.',
    kind: 'prompt',
  },
  {
    name: 'create',
    description: 'Create a new entity (replace placeholders before sending)',
    template:
      'Create entity <Name> in package <package>. Suggest reasonable attributes with types and descriptions. Mark a primary key.',
    kind: 'prompt',
  },
  {
    name: 'relate',
    description: 'Create a relationship between two entities',
    template:
      'Create a relationship from <SourceEntity> to <TargetEntity> with cardinality one-to-many. Add a description.',
    kind: 'prompt',
  },
  {
    name: 'export',
    description: 'Generate Markdown documentation for the current package',
    template:
      'Generate Markdown documentation {pageContext}. List entities with their attributes and relationships in a readable format.',
    kind: 'prompt',
  },
] as const;

/**
 * Match a leading `/word` at the very start of the composer input.
 * Returns the partial command name (no leading `/`) when active, or
 * null when the input doesn't look like a slash command. The picker
 * stays anchored to the start of the input — we deliberately do NOT
 * trigger mid-line; that would conflict with paths and dates.
 */
const SLASH_PREFIX_RE = /^\/([a-zA-Z][\w-]{0,29})?$/;

export function extractSlashToken(value: string): string | null {
  const m = value.match(SLASH_PREFIX_RE);
  if (!m) return null;
  return m[1] ?? '';
}

/**
 * Filter commands by case-insensitive prefix-then-substring on the name,
 * matching the same ranking the mention picker uses (#54).
 */
export function filterSlashCommands(token: string): readonly SlashCommand[] {
  if (!token) return SLASH_COMMANDS;
  const tl = token.toLowerCase();
  const rank = (name: string): number => {
    const n = name.toLowerCase();
    if (n === tl) return 0;
    if (n.startsWith(tl)) return 1;
    if (n.includes(tl)) return 2;
    return 99;
  };
  return SLASH_COMMANDS
    .map(c => ({ c, r: rank(c.name) }))
    .filter(x => x.r < 99)
    .sort((a, b) => a.r - b.r || a.c.name.localeCompare(b.c.name))
    .map(x => x.c);
}

/**
 * Substitute `{pageContext}` in the template with a natural reading of
 * the current page (or omit the phrase entirely when no context is
 * available so the prompt doesn't read "describe the entity ."). Other
 * placeholders are passed through verbatim — built-in slash commands
 * do not currently parameterize anything else.
 */
export function expandTemplate(template: string, pageContext?: string): string {
  if (!template.includes('{pageContext}')) return template;
  if (pageContext && pageContext.trim().length > 0) {
    // Page context already starts with "Currently viewing …" — splice it
    // in lower-case so it reads naturally inside the templated sentence.
    const phrase = `for the page you are on (${pageContext.trim().replace(/\.$/, '')})`;
    return template.split('{pageContext}').join(phrase);
  }
  // Drop the placeholder entirely along with surrounding whitespace so
  // the resulting sentence stays grammatical.
  return template.replace(/\s*\{pageContext\}/g, '');
}

/**
 * Build the inline help message rendered by `/help`. Lists every
 * registered command with its description so the user can see what's
 * available without leaving the chat.
 */
export function buildHelpMessage(): string {
  const lines = SLASH_COMMANDS.map(c => `\`/${c.name}\` — ${c.description}`);
  return `**Slash commands**\n\n${lines.join('\n')}`;
}
