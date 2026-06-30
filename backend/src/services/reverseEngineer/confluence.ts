/**
 * Confluence **Server / Data Center** enricher (REST API).
 *
 * Dumps a configured space's pages into the local store as text, so the AI
 * synthesis stage has the domain documentation to retrieve from. Unlike Jira
 * (keyed by tickets found in commits), Confluence has no natural key in the CIR,
 * so we dump a whole space (bounded by `limit`) — the "store it locally to
 * query" corpus from the brief.
 *
 * Auth mirrors Jira: PAT → `Authorization: Bearer`, or basic user:password.
 * Cloud (`/wiki/rest/api`, different content model) is NOT targeted here.
 */
import fs from 'fs';
import path from 'path';

export interface ConfluenceConfig {
  baseUrl: string;
  authType?: 'token' | 'basic';
  token?: string;
  user?: string;
  password?: string;
  spaceKey?: string;
  limit?: number;
  enabled?: boolean;
}

export interface ConfluencePage {
  id: string;
  title: string;
  space?: string;
  version?: number;
  url: string;
  text: string;
  fetchedAt: string;
}

function authHeader(cfg: ConfluenceConfig): string {
  const useBasic = cfg.authType === 'basic' || (!cfg.token && cfg.user);
  if (useBasic) {
    if (!cfg.user || !cfg.password) throw new Error('Confluence basic auth needs user + password');
    return 'Basic ' + Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
  }
  if (!cfg.token) throw new Error('Confluence token (PAT) is required');
  return `Bearer ${cfg.token}`;
}
const apiBase = (cfg: ConfluenceConfig) => cfg.baseUrl.replace(/\/+$/, '');

/** Minimal Confluence "storage format" (XHTML) → plain text. Good enough for AI retrieval. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(h[1-6])[^>]*>/gi, '\n\n# ')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\s*(br|p|div|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Validate credentials; returns the space name (or 'ok'). */
export async function testConfluence(cfg: ConfluenceConfig): Promise<string> {
  const url = cfg.spaceKey
    ? `${apiBase(cfg)}/rest/api/space/${encodeURIComponent(cfg.spaceKey)}`
    : `${apiBase(cfg)}/rest/api/content?limit=1`;
  const res = await fetch(url, { headers: { Authorization: authHeader(cfg), Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Confluence responded ${res.status} ${res.statusText}`);
  const j = (await res.json()) as { name?: string };
  return j.name ?? 'ok';
}

export interface DumpResult {
  pages: ConfluencePage[];
  errors: string[];
}

/** Page through a space's content, convert each page to text, cache under enrichment/confluence/. */
export async function dumpConfluenceSpace(cfg: ConfluenceConfig, opts: { outDir?: string } = {}): Promise<DumpResult> {
  if (!cfg.spaceKey) return { pages: [], errors: ['no spaceKey configured'] };
  const max = cfg.limit ?? 50;
  const pageSize = Math.min(max, 50);
  const base = apiBase(cfg);
  const stamp = new Date().toISOString();
  const result: DumpResult = { pages: [], errors: [] };

  for (let start = 0; result.pages.length < max; start += pageSize) {
    let batch: { results?: unknown[] };
    try {
      const res = await fetch(
        `${base}/rest/api/content?spaceKey=${encodeURIComponent(cfg.spaceKey)}&type=page&expand=body.storage,version,space&limit=${pageSize}&start=${start}`,
        { headers: { Authorization: authHeader(cfg), Accept: 'application/json' } },
      );
      if (!res.ok) { result.errors.push(`content ${res.status} at start=${start}`); break; }
      batch = (await res.json()) as { results?: unknown[] };
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
      break;
    }
    const rows = batch.results ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as any;
      const page: ConfluencePage = {
        id: String(r.id),
        title: r.title ?? '',
        space: r.space?.key ?? cfg.spaceKey,
        version: r.version?.number,
        url: `${base}/pages/viewpage.action?pageId=${r.id}`,
        text: htmlToText(r.body?.storage?.value ?? ''),
        fetchedAt: stamp,
      };
      result.pages.push(page);
      if (opts.outDir) writePage(opts.outDir, page);
      if (result.pages.length >= max) break;
    }
    if (rows.length < pageSize) break;
  }
  return result;
}

function writePage(outDir: string, page: ConfluencePage): void {
  const dir = path.join(outDir, 'enrichment', 'confluence');
  fs.mkdirSync(dir, { recursive: true });
  const front = `---\ntitle: ${JSON.stringify(page.title)}\nspace: ${page.space ?? ''}\nversion: ${page.version ?? ''}\nurl: ${page.url}\nfetchedAt: ${page.fetchedAt}\n---\n\n`;
  fs.writeFileSync(path.join(dir, `${page.id}.md`), front + page.text + '\n');
}
