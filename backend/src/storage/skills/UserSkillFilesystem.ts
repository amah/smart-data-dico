import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const SKILL_FILE = 'SKILL.md';
const MAX_RESOURCE_FILES = 200;

export interface UserSkillFile {
  name: string;
  content: string;
  resources: string[];
}

function isSkillName(name: string): boolean {
  return /^[A-Za-z][\w-]{0,63}$/.test(name);
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function realpathOrNull(candidate: string): Promise<string | null> {
  try {
    return await fs.realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function listResources(root: string, dir: string, prefix = ''): Promise<string[]> {
  const resources: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    for (const entry of entries) {
      if (resources.length >= MAX_RESOURCE_FILES) break;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relative === SKILL_FILE) continue;
      const absolute = path.join(dir, entry.name);
      const real = await realpathOrNull(absolute);
      if (!real || !isContained(root, real)) continue;
      if (entry.isDirectory()) {
        resources.push(...(await listResources(root, real, relative)).slice(0, MAX_RESOURCE_FILES - resources.length));
      } else if (entry.isFile()) {
        resources.push(relative);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return resources;
    throw error;
  }
  return resources;
}

/** Filesystem boundary for Claude-compatible personal skills under ~/.claude/skills. */
export class UserSkillFilesystem {
  constructor(private readonly skillsDir = path.join(os.homedir(), '.claude', 'skills')) {}

  async list(): Promise<UserSkillFile[]> {
    const root = await realpathOrNull(this.skillsDir);
    if (!root) return [];

    const entries = await fs.readdir(root, { withFileTypes: true, encoding: 'utf8' });
    const skills: UserSkillFile[] = [];
    for (const entry of entries) {
      if (skills.length >= 100 || !entry.isDirectory() || !isSkillName(entry.name)) continue;
      const skillRoot = await realpathOrNull(path.join(root, entry.name));
      if (!skillRoot || !isContained(root, skillRoot)) continue;
      const skillFile = await realpathOrNull(path.join(skillRoot, SKILL_FILE));
      if (!skillFile || !isContained(skillRoot, skillFile)) continue;
      const content = await fs.readFile(skillFile, 'utf8');
      const resources = await listResources(skillRoot, skillRoot);
      skills.push({ name: entry.name, content, resources });
    }
    return skills;
  }

  async readResource(skillName: string, relativePath: string): Promise<string> {
    if (!isSkillName(skillName)) throw new Error('Invalid skill name');
    const root = await realpathOrNull(this.skillsDir);
    const skillRoot = root && await realpathOrNull(path.join(root, skillName));
    if (!root || !skillRoot || !isContained(root, skillRoot)) throw new Error(`Unknown user skill: ${skillName}`);

    const normalized = relativePath.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error('Resource path must stay inside the skill directory');
    }
    const target = await realpathOrNull(path.join(skillRoot, normalized));
    if (!target || !isContained(skillRoot, target)) throw new Error(`Skill resource not found: ${relativePath}`);
    const stat = await fs.stat(target);
    if (!stat.isFile()) throw new Error(`Skill resource is not a file: ${relativePath}`);
    return fs.readFile(target, 'utf8');
  }
}
