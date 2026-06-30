/**
 * Jira **Server / Data Center** enricher (REST API v2).
 *
 * Takes the ticket ids the correlator already extracted from commits/changeSets,
 * fetches each issue, caches it locally (with `fetchedAt` for staleness), and
 * attaches a `jira` provenance entry to every CIR element those tickets touched.
 * The cached issue JSON is the "why" the AI synthesis stage reads later.
 *
 * Auth (Server/DC): a Personal Access Token → `Authorization: Bearer <token>`
 * (Jira 8.14+), or basic `user:password`. Cloud (ADF descriptions, /rest/api/3)
 * is intentionally NOT targeted here.
 */
import fs from 'fs';
import path from 'path';
import type { CIRElement } from './types.js';

export interface JiraConfig {
  baseUrl: string;
  authType?: 'token' | 'basic';
  token?: string;
  user?: string;
  password?: string;
  enabled?: boolean;
}

export interface JiraIssue {
  key: string;
  summary: string;
  description?: string;
  type?: string;
  status?: string;
  labels: string[];
  components: string[];
  parent?: string;
  links: Array<{ type: string; key: string }>;
  fixVersions: string[];
  created?: string;
  updated?: string;
  url: string;
  fetchedAt: string;
}

const FIELDS = 'summary,description,issuetype,status,labels,components,parent,issuelinks,fixVersions,created,updated';

function authHeader(cfg: JiraConfig): string {
  const useBasic = cfg.authType === 'basic' || (!cfg.token && cfg.user);
  if (useBasic) {
    if (!cfg.user || !cfg.password) throw new Error('Jira basic auth needs user + password');
    return 'Basic ' + Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
  }
  if (!cfg.token) throw new Error('Jira token (PAT) is required');
  return `Bearer ${cfg.token}`;
}

const apiBase = (cfg: JiraConfig) => cfg.baseUrl.replace(/\/+$/, '');

/** Validate credentials against /rest/api/2/myself; returns the display name. */
export async function testJira(cfg: JiraConfig): Promise<string> {
  const res = await fetch(`${apiBase(cfg)}/rest/api/2/myself`, {
    headers: { Authorization: authHeader(cfg), Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Jira responded ${res.status} ${res.statusText}`);
  const me = (await res.json()) as { displayName?: string; name?: string };
  return me.displayName ?? me.name ?? 'ok';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(raw: any, base: string, fetchedAt: string): JiraIssue {
  const f = raw.fields ?? {};
  return {
    key: raw.key,
    summary: f.summary ?? '',
    description: typeof f.description === 'string' ? f.description : undefined,
    type: f.issuetype?.name,
    status: f.status?.name,
    labels: f.labels ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    components: (f.components ?? []).map((c: any) => c.name),
    parent: f.parent?.key,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    links: (f.issuelinks ?? []).map((l: any) => ({ type: l.type?.name ?? '', key: (l.outwardIssue ?? l.inwardIssue)?.key ?? '' })).filter((l: { key: string }) => l.key),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fixVersions: (f.fixVersions ?? []).map((v: any) => v.name),
    created: f.created,
    updated: f.updated,
    url: `${base}/browse/${raw.key}`,
    fetchedAt,
  };
}

async function fetchIssue(cfg: JiraConfig, key: string, fetchedAt: string): Promise<JiraIssue | null> {
  const res = await fetch(`${apiBase(cfg)}/rest/api/2/issue/${encodeURIComponent(key)}?fields=${FIELDS}`, {
    headers: { Authorization: authHeader(cfg), Accept: 'application/json' },
  });
  if (res.status === 404) return null; // ticket id with no matching issue — skip
  if (!res.ok) throw new Error(`Jira ${res.status} for ${key}`);
  return normalize(await res.json(), apiBase(cfg), fetchedAt);
}

const cachePath = (outDir: string, key: string) => path.join(outDir, 'enrichment', 'jira', `${key}.json`);

function readCache(outDir: string | undefined, key: string, ttlMs: number, now: number): JiraIssue | undefined {
  if (!outDir) return undefined;
  try {
    const issue = JSON.parse(fs.readFileSync(cachePath(outDir, key), 'utf-8')) as JiraIssue;
    if (now - new Date(issue.fetchedAt).getTime() < ttlMs) return issue;
  } catch { /* miss */ }
  return undefined;
}

function writeCache(outDir: string, issue: JiraIssue): void {
  const p = cachePath(outDir, issue.key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(issue, null, 2) + '\n');
}

export interface EnrichResult {
  issues: Map<string, JiraIssue>;
  fetched: number;
  cached: number;
  errors: Array<{ key: string; error: string }>;
}

/** Fetch (or read cached) issues for `tickets`; write to the store when `outDir` set. */
export async function enrichWithJira(
  tickets: string[],
  cfg: JiraConfig,
  opts: { outDir?: string; ttlMs?: number } = {},
): Promise<EnrichResult> {
  const ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
  const now = Date.now();
  const stamp = new Date().toISOString();
  const result: EnrichResult = { issues: new Map(), fetched: 0, cached: 0, errors: [] };

  for (const key of tickets) {
    const hit = readCache(opts.outDir, key, ttlMs, now);
    if (hit) { result.issues.set(key, hit); result.cached++; continue; }
    try {
      const issue = await fetchIssue(cfg, key, stamp);
      if (issue) {
        if (opts.outDir) writeCache(opts.outDir, issue);
        result.issues.set(key, issue);
        result.fetched++;
      }
    } catch (err) {
      result.errors.push({ key, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/** Add a `jira` provenance entry to every element whose provenance cites an enriched ticket. */
export function attachJira(elements: Iterable<CIRElement>, issues: Map<string, JiraIssue>): void {
  for (const el of elements) {
    const tickets = new Set(el.provenance.map((p) => p.ticket).filter((t): t is string => !!t));
    for (const t of tickets) {
      const issue = issues.get(t);
      if (!issue) continue;
      if (el.provenance.some((p) => p.source === 'jira' && p.ticket === t)) continue;
      el.provenance.push({ source: 'jira', ref: issue.url, ticket: t, fetchedAt: issue.fetchedAt });
    }
  }
}
