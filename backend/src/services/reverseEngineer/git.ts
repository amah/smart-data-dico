/**
 * Git correlation: find the commit that introduced a Liquibase changeSet, so we
 * can attach commit metadata + ticket ids to the lifecycle event.
 *
 * Strategy: pickaxe (`git log -S<changeSetId> -- <changelogFile>`). The earliest
 * commit that changed the occurrence count of that id is the one that added it.
 */
import { execFileSync } from 'child_process';
import { extractTickets } from './types.js';

export interface CommitInfo {
  sha: string;
  author?: string;
  email?: string;
  date?: string;
  message?: string;
  tickets?: string[];
}

// Control-char separators so commit subjects/bodies (which contain spaces and
// newlines) never collide with the delimiters.
const FS = '\x1f'; // field
const RS = '\x1e'; // record

function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
}

export function gitAvailable(repoRoot: string): boolean {
  try {
    git(repoRoot, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Commit that introduced `changeSetId` in `file`. Returns the oldest matching
 * commit (the addition); its full message feeds ticket detection.
 */
export function findIntroducingCommit(repoRoot: string, file: string, changeSetId: string): CommitInfo | undefined {
  let raw: string;
  try {
    raw = git(repoRoot, [
      'log',
      `-S${changeSetId}`,
      `--pretty=format:%H${FS}%an${FS}%ae${FS}%aI${FS}%B${RS}`,
      '--',
      file,
    ]);
  } catch {
    return undefined;
  }
  const records = raw.split(RS).map((r) => r.trim()).filter(Boolean);
  if (records.length === 0) return undefined;
  // git log is newest-first → the addition is the LAST record.
  const [sha, author, email, date, message = ''] = records[records.length - 1].split(FS);
  return { sha, author, email, date, message: message.trim(), tickets: extractTickets(message, changeSetId) };
}

/** Oldest commit that touched `file` — used to date/attribute a JPA entity. */
export function firstCommit(repoRoot: string, file: string): CommitInfo | undefined {
  let raw: string;
  try {
    raw = git(repoRoot, ['log', '--reverse', `--pretty=format:%H${FS}%an${FS}%ae${FS}%aI${FS}%B${RS}`, '--', file]);
  } catch {
    return undefined;
  }
  const first = raw.split(RS).map((r) => r.trim()).filter(Boolean)[0];
  if (!first) return undefined;
  const [sha, author, email, date, message = ''] = first.split(FS);
  return { sha, author, email, date, message: message.trim(), tickets: extractTickets(message) };
}
