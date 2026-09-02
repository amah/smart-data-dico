import fs from 'fs';
import os from 'os';
import path from 'path';
import { InMemoryStorageBackend } from '../../../storage/memory/InMemoryStorageBackend.js';
import { storageRegistry } from '../../../storage/contract/StorageBackendToken.js';
import { wsId } from '../../../storage/contract/types.js';
import { UserSkillFilesystem } from '../../../storage/skills/UserSkillFilesystem.js';
import {
  getSkill,
  getSkillResource,
  listSkills,
  loadAgentWorkspaceContext,
} from '../skillService.js';

describe('Claude-compatible AI workspace context', () => {
  const ws = wsId('dictionaries');
  let userRoot: string;
  let userFilesystem: UserSkillFilesystem;

  beforeEach(() => {
    const backend = new InMemoryStorageBackend();
    backend.files.set(String(ws), new Map([
      ['CLAUDE.md', 'Prefer concise explanations.'],
      ['AGENTS.md', 'Always preserve UUIDs.'],
      [
        '.claude/skills/review/SKILL.md',
        '---\nname: review\ndescription: Project review workflow\nallowed-tools: Bash\n---\nRun the project review.',
      ],
      ['.claude/skills/review/checklist.md', 'Project checklist'],
      [
        '.claude/skills/model/SKILL.md',
        '---\ndescription: Model a bounded context\n---\nModel carefully. Do not execute `$(dangerous)`.',
      ],
      ['.claude/skills/model/references/types.md', 'Use logical types.'],
    ]));
    storageRegistry.setBackend(backend);

    userRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dico-user-skills-'));
    fs.mkdirSync(path.join(userRoot, 'review'), { recursive: true });
    fs.writeFileSync(
      path.join(userRoot, 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Personal review workflow\n---\nUse the personal review instructions.',
    );
    fs.writeFileSync(path.join(userRoot, 'review', 'notes.md'), 'Personal notes');
    userFilesystem = new UserSkillFilesystem(userRoot);
  });

  afterEach(() => {
    storageRegistry.reset();
    fs.rmSync(userRoot, { recursive: true, force: true });
  });

  it('loads root instructions and gives personal skills precedence over project skills', async () => {
    const context = await loadAgentWorkspaceContext([
      { role: 'user', parts: [{ type: 'text', text: '/review ordering' }] },
    ], userFilesystem);

    expect(context.instructions).toEqual({
      claude: 'Prefer concise explanations.',
      agents: 'Always preserve UUIDs.',
    });
    expect(context.skills).toEqual([
      { name: 'model', description: 'Model a bounded context', source: 'project' },
      { name: 'review', description: 'Personal review workflow', source: 'user' },
    ]);
    expect(context.explicitSkill).toBe('review');
    expect(context.prompt).toContain('Invocation arguments: ordering');
    expect(context.prompt).toContain('Use the personal review instructions.');
    expect(context.prompt).not.toContain('Run the project review.');
    expect(context.prompt.indexOf('<CLAUDE.md>')).toBeLessThan(context.prompt.indexOf('<AGENTS.md>'));
  });

  it('loads skill bodies and text resources without executing embedded commands', async () => {
    const skill = await getSkill('model', userFilesystem);
    expect(skill).toMatchObject({
      name: 'model',
      source: 'project',
      instructions: 'Model carefully. Do not execute `$(dangerous)`.',
      resources: ['references/types.md'],
    });

    await expect(getSkillResource('model', 'references/types.md', userFilesystem)).resolves.toMatchObject({
      content: 'Use logical types.',
      source: 'project',
    });
    await expect(getSkillResource('review', 'notes.md', userFilesystem)).resolves.toMatchObject({
      content: 'Personal notes',
      source: 'user',
    });
  });

  it('rejects traversal and ignores directories without SKILL.md', async () => {
    fs.mkdirSync(path.join(userRoot, 'empty'), { recursive: true });
    expect((await listSkills(userFilesystem)).map(skill => skill.name)).toEqual(['model', 'review']);
    await expect(getSkillResource('review', '../outside.md', userFilesystem))
      .rejects.toThrow('Resource path must stay inside the skill directory');
  });
});
