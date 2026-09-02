import { z } from 'zod';
import { registerAgentTool } from './agentToolRegistry.js';
import { getSkill, getSkillResource, listSkills } from './skillService.js';

export function registerSkillAgentTools(): void {
  registerAgentTool({
    name: 'listSkills',
    description: 'List project and personal Claude-compatible skills available to this agent. Skill bodies are loaded on demand.',
    category: 'read',
    jsonSchema: { type: 'object', properties: {} },
    inputSchema: z.object({}),
    execute: async () => ({ summary: 'Available skills', skills: await listSkills() }),
  });

  registerAgentTool({
    name: 'getSkill',
    description: 'Load the SKILL.md instructions and resource list for one available skill before following it.',
    category: 'read',
    jsonSchema: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', description: 'Skill name from listSkills' } },
    },
    inputSchema: z.object({ name: z.string() }),
    execute: async ({ name }) => getSkill(name),
  });

  registerAgentTool({
    name: 'getSkillResource',
    description: 'Read one text resource referenced by a loaded skill. Paths are confined to that skill directory.',
    category: 'read',
    jsonSchema: {
      type: 'object',
      required: ['name', 'path'],
      properties: {
        name: { type: 'string', description: 'Skill name from listSkills' },
        path: { type: 'string', description: 'Relative resource path returned by getSkill' },
      },
    },
    inputSchema: z.object({ name: z.string(), path: z.string() }),
    execute: async ({ name, path: relativePath }) => getSkillResource(name, relativePath),
  });
}
