/**
 * HTTP layer for the reverse-engineer plugin.
 *  - run: mine a repo's Liquibase (+ optional JPA) into CIR + drift, optionally
 *    enriched from Jira Server.
 *  - jira config get/save/test: stored in ~/.dico-app/dico-app.json `jira` section
 *    (mode 0600), secret redacted on GET.
 */
import type { Request, Response } from 'express';
import { runReverseEngineer, type ReverseEngineerOptions } from '../services/reverseEngineer/reverseEngineerService.js';
import { testJira, type JiraConfig } from '../services/reverseEngineer/jira.js';
import { testConfluence, type ConfluenceConfig } from '../services/reverseEngineer/confluence.js';
import { getConfigSection, setConfigSection, CONFIG_FILE } from '../utils/appDir.js';
import { config } from '../kernel/config.js';
import { logger } from '../utils/logger.js';

const localOnly = (res: Response): boolean => {
  if (config.profile !== 'local') {
    res.status(403).json({ message: 'Reverse-engineering is only available in local mode' });
    return false;
  }
  return true;
};

const mask = (s?: string) => (s ? `${s.slice(0, 4)}…${s.slice(-2)}` : '');

/** Build run options from the request body (+ saved Jira/Confluence config). */
function buildOptions(body: Record<string, unknown> | undefined): { opts?: ReverseEngineerOptions; error?: string } {
  const b = body ?? {};
  if (!b.repoRoot || typeof b.repoRoot !== 'string') return { error: 'repoRoot (string) is required' };
  if (!b.changelog || typeof b.changelog !== 'string') return { error: 'changelog (string) is required' };
  const on = b.enrich !== false; // enrichment opts in by default
  const jiraCfg = getConfigSection<JiraConfig>('jira');
  const confCfg = getConfigSection<ConfluenceConfig>('confluence');
  return {
    opts: {
      repoRoot: b.repoRoot,
      changelog: b.changelog,
      srcDir: typeof b.srcDir === 'string' ? b.srcDir : undefined,
      out: typeof b.out === 'string' ? b.out : undefined,
      emitDico: typeof b.emitDico === 'string' && b.emitDico ? b.emitDico : undefined,
      jira: on && jiraCfg?.enabled && jiraCfg.baseUrl ? jiraCfg : undefined,
      confluence: on && confCfg?.enabled && confCfg.baseUrl && confCfg.spaceKey ? confCfg : undefined,
    },
  };
}

/** POST /api/reverse-engineer/run — extract CIR (+ drift, + Jira/Confluence enrichment). */
export const reverseEngineerRun = async (req: Request, res: Response) => {
  if (!localOnly(res)) return;
  const { opts, error } = buildOptions(req.body);
  if (error) return res.status(400).json({ message: error });
  try {
    const result = await runReverseEngineer(opts!);
    res.json({ message: 'Extracted', data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Reverse-engineer failed: ${message}`);
    res.status(422).json({ message: 'Extraction failed', error: message });
  }
};

/**
 * POST /api/reverse-engineer/run-stream — same run, but streams NDJSON progress
 * events ({type:'progress', stage, status, …}) live for the UI analysis panel,
 * then a final {type:'result', data} (or {type:'error'}).
 */
export const reverseEngineerRunStream = async (req: Request, res: Response) => {
  if (!localOnly(res)) return;
  const { opts, error } = buildOptions(req.body);
  if (error) return res.status(400).json({ message: error });
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering so events flush live
  const write = (o: unknown) => res.write(JSON.stringify(o) + '\n');
  try {
    const result = await runReverseEngineer({ ...opts!, onProgress: (e) => write({ type: 'progress', ...e }) });
    write({ type: 'result', data: result });
  } catch (err: unknown) {
    write({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
};

/** GET /api/reverse-engineer/jira-config — redacted Jira config. */
export const jiraGetConfig = (_req: Request, res: Response) => {
  const cfg = getConfigSection<JiraConfig>('jira');
  res.json({
    baseUrl: cfg?.baseUrl ?? '',
    authType: cfg?.authType ?? 'token',
    user: cfg?.user ?? '',
    token: mask(cfg?.token), // never echo the raw token
    hasPassword: !!cfg?.password,
    enabled: cfg?.enabled ?? false,
    configPath: CONFIG_FILE,
  });
};

/** POST /api/reverse-engineer/jira-config — save (blank secret keeps the existing one). */
export const jiraSaveConfig = (req: Request, res: Response) => {
  const { baseUrl, authType, token, user, password, enabled } = req.body ?? {};
  if (!baseUrl || typeof baseUrl !== 'string') return res.status(400).json({ message: 'baseUrl is required' });
  const existing = getConfigSection<JiraConfig>('jira') ?? ({} as JiraConfig);
  const cfg: JiraConfig = {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    authType: authType === 'basic' ? 'basic' : 'token',
    enabled: !!enabled,
    token: token ? String(token) : existing.token, // blank → keep existing
    user: user !== undefined ? String(user) : existing.user,
    password: password ? String(password) : existing.password,
  };
  setConfigSection('jira', cfg);
  logger.info('Jira config saved'); // never logs the secret
  res.json({ message: 'Jira configuration saved', configPath: CONFIG_FILE });
};

/** POST /api/reverse-engineer/jira-test — validate the saved credentials. */
export const jiraTestConnection = async (_req: Request, res: Response) => {
  const cfg = getConfigSection<JiraConfig>('jira');
  if (!cfg?.baseUrl) return res.status(400).json({ ok: false, error: 'Jira is not configured' });
  try {
    const who = await testJira(cfg);
    res.json({ ok: true, user: who });
  } catch (err: unknown) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

/** GET /api/reverse-engineer/confluence-config — redacted Confluence config. */
export const confluenceGetConfig = (_req: Request, res: Response) => {
  const cfg = getConfigSection<ConfluenceConfig>('confluence');
  res.json({
    baseUrl: cfg?.baseUrl ?? '',
    authType: cfg?.authType ?? 'token',
    user: cfg?.user ?? '',
    token: mask(cfg?.token),
    hasPassword: !!cfg?.password,
    spaceKey: cfg?.spaceKey ?? '',
    limit: cfg?.limit ?? 50,
    enabled: cfg?.enabled ?? false,
    configPath: CONFIG_FILE,
  });
};

/** POST /api/reverse-engineer/confluence-config — save (blank secret keeps existing). */
export const confluenceSaveConfig = (req: Request, res: Response) => {
  const { baseUrl, authType, token, user, password, spaceKey, limit, enabled } = req.body ?? {};
  if (!baseUrl || typeof baseUrl !== 'string') return res.status(400).json({ message: 'baseUrl is required' });
  const existing = getConfigSection<ConfluenceConfig>('confluence') ?? ({} as ConfluenceConfig);
  const cfg: ConfluenceConfig = {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    authType: authType === 'basic' ? 'basic' : 'token',
    enabled: !!enabled,
    spaceKey: spaceKey !== undefined ? String(spaceKey) : existing.spaceKey,
    limit: Number(limit) > 0 ? Number(limit) : existing.limit ?? 50,
    token: token ? String(token) : existing.token,
    user: user !== undefined ? String(user) : existing.user,
    password: password ? String(password) : existing.password,
  };
  setConfigSection('confluence', cfg);
  logger.info('Confluence config saved');
  res.json({ message: 'Confluence configuration saved', configPath: CONFIG_FILE });
};

/** POST /api/reverse-engineer/confluence-test — validate the saved credentials. */
export const confluenceTestConnection = async (_req: Request, res: Response) => {
  const cfg = getConfigSection<ConfluenceConfig>('confluence');
  if (!cfg?.baseUrl) return res.status(400).json({ ok: false, error: 'Confluence is not configured' });
  try {
    const name = await testConfluence(cfg);
    res.json({ ok: true, space: name });
  } catch (err: unknown) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
