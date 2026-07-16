import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import { usePrefs } from '../../../hooks/usePrefs';
import {
  AIToolCategory,
  loadPolicy,
  shouldAutoApprove,
} from '../utils/aiAutoApprovePolicy';
import { validateNavigatePath } from '../utils/validateNavigatePath';
import { Chip } from '../../../components/ui';
import { processMentions } from '../../../components/EntityMention';
import MermaidDiagram from './MermaidDiagram';
import SqlRunModal from './SqlRunModal';
import { getAllPackageHierarchies } from '../../../services/api';
import {
  SlashCommand,
  extractSlashToken,
  filterSlashCommands,
  expandTemplate,
  buildHelpMessage,
} from '../utils/aiSlashCommands';
import { runAiCommand } from '../commands';
import type { AIToolDef, Conversation } from '../services/AIService';
import { conversationToMarkdown, conversationFilename } from '../utils/conversationExport';

SyntaxHighlighter.registerLanguage('ts', typescript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('tsx', tsx);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('jsx', jsx);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);

interface AIChatPanelProps {
  open: boolean;
  onClose: () => void;
}

// Auto-scroll lock threshold: how many pixels from the bottom counts
// as "still pinned" so streaming deltas continue to scroll. (#126)
const SCROLL_LOCK_THRESHOLD_PX = 50;
// Delta coalescing window: text-delta events arrive token-by-token,
// we batch them and flush at ~50ms to cut DOM thrash. (#126)
const DELTA_FLUSH_INTERVAL_MS = 50;

/**
 * Map the current router pathname to a short "what the user is currently
 * looking at" sentence the AI can prepend to the system prompt.
 *
 * Returns an empty string for routes that have no useful page context.
 * Exported so it can be unit-tested without rendering the panel. (#58)
 */
export function getPageContext(pathname: string): string {
  if (!pathname) return '';

  // /packages/<pkg>/entities/<name>
  const entityMatch = pathname.match(/^\/packages\/([^/]+)\/entities\/([^/]+)\/?$/);
  if (entityMatch) {
    const [, pkg, name] = entityMatch;
    return `Currently viewing entity ${decodeURIComponent(name)} in package ${decodeURIComponent(pkg)}.`;
  }

  // /packages/<pkg>/perspectives/<name>
  const perspectiveMatch = pathname.match(/^\/packages\/([^/]+)\/perspectives\/([^/]+)\/?$/);
  if (perspectiveMatch) {
    const [, pkg, name] = perspectiveMatch;
    return `Currently viewing perspective ${decodeURIComponent(name)} in package ${decodeURIComponent(pkg)}.`;
  }

  // /packages/<pkg>
  const packageMatch = pathname.match(/^\/packages\/([^/]+)\/?$/);
  if (packageMatch) {
    const [, pkg] = packageMatch;
    return `Currently viewing package ${decodeURIComponent(pkg)}.`;
  }

  return '';
}

interface ToolCall {
  id: string;
  name: string;
  input: any;
  output: any;
  // Category sourced from the backend tool-input-start event (#59).
  // Drives both the per-card indicator and the per-card auto-approve
  // decision. Older backends won't send it; we fall back to "review for
  // safety" when category is missing.
  category?: AIToolCategory;
  // status:
  //  - undefined  = auto-approved (default), terminal state
  //  - 'starting' = tool-input-start received, args not yet available
  //  - 'running'  = tool-input-available received, executing
  //  - 'pending'  = waiting on user review (per-category policy), terminal state
  //  - 'approved' = user approved, terminal state
  //  - 'undone'   = user rolled back, terminal state
  //  - 'cancelled' = stream was aborted while this tool was in flight
  status?: 'starting' | 'running' | 'pending' | 'approved' | 'undone' | 'cancelled';
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCall[];
  rawEvents?: any[];
  // True when the user aborted mid-stream. Persisted in the saved
  // conversation so reloading shows the cancellation marker. (#61)
  cancelled?: boolean;
  // #63 — when present, the backend condensed older history before this
  // turn was sent. We render a small "Context condensed (N messages)"
  // pill above the assistant bubble so the user can see why the model
  // doesn't have full memory of every prior turn.
  condensed?: { count: number; estimatedTokens?: number };
  // #192 — when present, the agentic tool-call loop stopped because it hit
  // its step budget (`limit`) rather than the model finishing naturally. We
  // render a visible, non-error info pill below the bubble; the model's
  // summary of what it changed / what remains arrived as normal text above.
  stepLimit?: { limit: number };
  // #confab-guard — when present, the model claimed it changed the model but no
  // create/update/delete tool actually succeeded this turn. Rendered as a
  // visible warning pill so a confabulated "Done!" doesn't read as real.
  noOpWarning?: string;
  // #64 — true when the turn was started in background autonomous
  // mode. Drives the post-run summary footer (Review / Undo all).
  autonomous?: boolean;
  // Server-side approval gate: streamId of the turn that produced this
  // message, so the per-card Approve / Reject controls can POST a decision
  // to unblock (or reject) a gated tool while the stream is still in flight.
  // Not persisted to disk meaningfully (the stream is gone after reload) —
  // it's only useful for the live turn.
  streamId?: string;
}

/**
 * Running token / cost totals for the conversation (#128).
 *
 * Updated on every `usage` SSE event (one per turn). `cost` only
 * appears when the backend has per-model pricing configured under
 * `dico-app.json.ai.pricing`; the chip just shows the token counts
 * otherwise.
 */
interface UsageMeter {
  inputTokens: number;
  outputTokens: number;
  cost?: number;
}

/**
 * Format a token count compactly: 1234 → "1.2k", 1_200_000 → "1.2M".
 * Below 1000 we render the integer untouched so small chats don't read
 * "0.3k". Single source of truth for the header chip.
 */
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * Format a USD cost. We show four decimal places when the cost is
 * below 1¢ so the user can see micro-spend, otherwise three.
 */
function formatCost(c: number): string {
  if (c < 0.01) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(3)}`;
}

type PanelView = 'chat' | 'history' | 'raw' | 'tools' | 'prompts';

// #55 — chat modes. Designer = full toolset (default, back-compat).
// Ask = read-only Q&A. Review = read-only quality review. Stored
// per-conversation; the frontend sends it on every chat request.
export type ChatMode = 'designer' | 'ask' | 'review';
const CHAT_MODES: readonly ChatMode[] = ['designer', 'ask', 'review'] as const;

interface SavedPrompt {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export default function AIChatPanel({ open, onClose }: AIChatPanelProps) {
  const navigate = useNavigate();
  const { theme } = usePrefs();
  const isDark = theme === 'dark';
  const location = useLocation();
  const pageContext = useMemo(() => getPageContext(location.pathname), [location.pathname]);
  // #run-sql — resolve which package's DB to run against: the one in the URL, or
  // the first package as a fallback (the modal shows the name so it can be cancelled).
  const runSqlBlock = useCallback(async (sql: string) => {
    let pkg = location.pathname.match(/\/packages\/([^/?#]+)/)?.[1];
    if (!pkg) {
      try { pkg = (await getAllPackageHierarchies())[0]?.name; } catch { /* ignore */ }
    }
    if (!pkg) { setError('Open a package first to run SQL against its database.'); return; }
    setSqlToRun({ sql, packageName: pkg });
  }, [location.pathname]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');

  // Panel width — horizontal resize by dragging the left edge; persisted.
  const PANEL_MIN = 320;
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem('ai-panel-width'));
    return v >= PANEL_MIN && v <= 1200 ? v : 420;
  });
  const startPanelResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    let latest = 0;
    const onMove = (ev: MouseEvent) => {
      // Panel is pinned to the right edge, so width grows as the cursor moves left.
      latest = Math.min(Math.max(window.innerWidth - ev.clientX, PANEL_MIN), Math.min(1200, window.innerWidth - 80));
      setPanelWidth(latest);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      if (latest) localStorage.setItem('ai-panel-width', String(Math.round(latest)));
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Restore the user's last composer height (native drag on the bottom-right corner).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const saved = Number(localStorage.getItem('ai-composer-height'));
    if (saved >= 28 && saved <= window.innerHeight) el.style.height = `${saved}px`;
  }, []);
  const persistComposerHeight = useCallback(() => {
    const el = inputRef.current;
    if (el?.style.height) localStorage.setItem('ai-composer-height', String(parseInt(el.style.height, 10)));
  }, []);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  // #run-sql — the ```sql block to run (Run button), opens SqlRunModal.
  const [sqlToRun, setSqlToRun] = useState<{ sql: string; packageName: string } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Structured upstream error fields (provider message, status, help URL).
  // Populated when the SSE stream emits a `type: 'error'` event with the
  // backend-enriched shape. Cleared alongside `error` on retry / send.
  const [errorDetails, setErrorDetails] = useState<{
    upstreamStatus?: number;
    providerMessage?: string;
    providerCode?: string | number;
    providerHelpUrl?: string;
    providerRaw?: string;
    diagnostics?: Record<string, unknown>;
  } | null>(null);
  const [conversationId, setConversationId] = useState<string>(crypto.randomUUID());
  const [conversationList, setConversationList] = useState<Array<{ id: string; title: string; messageCount: number; updatedAt: string; pinned?: boolean }>>([]);
  // #127 — history view: search query, inline rename buffer, per-conversation system prompt override.
  const [conversationQuery, setConversationQuery] = useState('');
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [systemPromptOverride, setSystemPromptOverride] = useState<string>('');
  const [systemPromptEditing, setSystemPromptEditing] = useState(false);
  // Running token / cost meter for the current conversation (#128).
  // Reset when the user starts or loads a different conversation; the
  // header chip (`~3.2k in / 1.1k out · $0.012`) is bound to this state.
  const [usage, setUsage] = useState<UsageMeter | null>(null);
  const [view, setView] = useState<PanelView>('chat');
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  // Tracks which error-state tool cards have "Show raw" expanded (separate
  // from the per-card expand toggle so the raw-output toggle survives
  // between user clicks). #61
  const [rawShownTools, setRawShownTools] = useState<Set<string>>(new Set());
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [toolDefs, setToolDefs] = useState<AIToolDef[]>([]);
  // Granular per-category auto-approve policy (#59). Loaded once on
  // mount; the Settings page is the only place that mutates it. The
  // legacy `ai-auto-approve` boolean is migrated by loadPolicy().
  const [policy, setPolicy] = useState(() => loadPolicy());
  // Auto-inject current page context into the chat request (#58). Default ON;
  // disabled cleanly when the current path has no useful context.
  const [includePageContext, setIncludePageContext] = useState<boolean>(() => {
    return localStorage.getItem('ai-include-page-context') !== 'false';
  });
  // Saved prompts (#123) — isolated state, kept out of chat/history/raw/tools logic
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [promptNameDraft, setPromptNameDraft] = useState('');
  const [promptContentDraft, setPromptContentDraft] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);
  // #55 — chat mode for the active conversation. Designer (default)
  // gates nothing; Ask / Review drop write tools server-side and use
  // mode-specific system-prompt suffixes. Persisted on the conversation
  // record so the choice survives reload.
  const [mode, setMode] = useState<ChatMode>('designer');
  // #64 — background autonomous mode. When on, every tool category
  // except `delete` is treated as auto-approve regardless of the
  // per-category policy (#59), so the agent runs end-to-end without
  // pausing for review. Persisted as a session preference (not per
  // conversation) since it's about how the user wants to work, not
  // about a particular chat.
  const [autonomous, setAutonomous] = useState<boolean>(() => {
    return localStorage.getItem('ai-autonomous') === 'true';
  });
  const toggleAutonomous = useCallback(() => {
    setAutonomous(prev => {
      const next = !prev;
      localStorage.setItem('ai-autonomous', String(next));
      return next;
    });
  }, []);
  // #54 — @entity / @package mention picker. Token is the partial after the
  // most recent `@` at the cursor; null when not actively picking.
  const [mentionToken, setMentionToken] = useState<string | null>(null);
  // #56 — slash command palette. Token is the partial command name after
  // a leading `/` at the start of the input (no leading `/` itself); null
  // when the input doesn't look like a slash command.
  const [slashToken, setSlashToken] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<{ entities: Array<{ name: string; packageName: string }>; packages: Array<{ name: string }> }>({ entities: [], packages: [] });
  // #57 — diff preview for createEntity-on-existing. Keyed by toolCallId.
  // Loaded on demand when the user clicks "Show diff" on a failing
  // createEntity card. Value: { existing, proposed } | 'loading' | 'error'.
  const [entityDiffs, setEntityDiffs] = useState<Record<string, { existing: any; proposed: any } | 'loading' | 'error'>>({});
  const [, setPendingReview] = useState(false);

  // If the user updates the policy in Settings (or another tab) while
  // the panel is open, pick it up so the next tool decision uses the
  // fresh values.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'ai-auto-approve-policy' || e.key === 'ai-auto-approve') {
        setPolicy(loadPolicy());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  // AbortController for the in-flight /api/ai/chat fetch so the Stop button
  // can break out of the agentic loop mid-flight (#61).
  const abortControllerRef = useRef<AbortController | null>(null);
  // streamId of the active turn, captured from the backend `start` /
  // `stream-id` SSE event. Used to target server-side tool-approval POSTs
  // so a blocked gated tool unblocks once approved (or stays pending until
  // the human decides). Map streamId → tool calls is implicit: only one
  // stream is in flight at a time.
  const streamIdRef = useRef<string | null>(null);
  // #178 slice 3 — name → def lookup for source attribution in the
  // tool-call card render. MCP tools have `source: 'mcp'` and a
  // `connectionLabel`; built-ins have neither.
  const toolDefByName = useMemo(() => {
    const m = new Map<string, AIToolDef>();
    for (const def of toolDefs) m.set(def.name, def);
    return m;
  }, [toolDefs]);

  // === #126 ergonomics state ===
  // Editing a previous user message: id of the message currently in
  // edit mode plus the in-flight draft text. On save we truncate
  // history *after* this message and re-send.
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  // Auto-scroll lock: when true the user has scrolled up from the
  // bottom and we should not yank the viewport on incoming deltas.
  // Resets to false on next user send.
  const [scrollLocked, setScrollLocked] = useState(false);
  // Toggled by the scroll-lock pill so we can announce "new messages
  // arrived while you were scrolled up".
  const [hasUnseenDeltas, setHasUnseenDeltas] = useState(false);
  // Buffer for coalesced text-delta events; flushed on a ~50ms
  // timer to keep one setState per window instead of per token.
  const deltaBufferRef = useRef<string>('');
  const deltaFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #ai-export — digest of the standing system prompt this conversation ran under
  // (from the backend `system-context` SSE event), saved with the conversation and
  // resolved for the export.
  const systemContextDigestRef = useRef<string | null>(null);

  // Tracks transient "Copied!" / "Copy failed" feedback per code block,
  // keyed by the code text so we don't need ids on every block. (#129)
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyFailedKey, setCopyFailedKey] = useState<string | null>(null);

  const handleCopy = useCallback(async (text: string) => {
    try {
      // navigator.clipboard.writeText requires a secure context (HTTPS or
      // localhost). On insecure contexts the call rejects; surface a
      // visible "Copy failed" so the user isn't left wondering.
      await navigator.clipboard.writeText(text);
      setCopyFailedKey(null);
      setCopiedKey(text);
      setTimeout(() => {
        setCopiedKey(prev => (prev === text ? null : prev));
      }, 1500);
    } catch {
      setCopiedKey(null);
      setCopyFailedKey(text);
      setTimeout(() => {
        setCopyFailedKey(prev => (prev === text ? null : prev));
      }, 1500);
    }
  }, []);

  useEffect(() => {
    runAiCommand('ai.status.get')
      .then(d => setAiAvailable(d.available))
      .catch(() => setAiAvailable(false));
  }, [open]);

  // Load conversation list and auto-resume the most recent one on first open
  const hasAutoLoaded = useRef(false);
  useEffect(() => {
    if (open) {
      const q = conversationQuery.trim() || undefined;
      runAiCommand('ai.conversation.list', { q }).then(list => {
        setConversationList(list);
        // Auto-load the most recent conversation on first open if no messages yet
        if (!hasAutoLoaded.current && messages.length === 0 && list.length > 0 && !conversationQuery) {
          hasAutoLoaded.current = true;
          loadConversation(list[0].id);
        }
      }).catch(() => {});
    }
  }, [open, messages.length, conversationQuery]);

  // #127 — patch a conversation field (rename, pinned, systemPrompt) and refresh list.
  const patchConversationFields = useCallback(async (
    id: string,
    patch: { title?: string; pinned?: boolean; systemPrompt?: string },
  ) => {
    try {
      await runAiCommand('ai.conversation.patch', { id, patch });
      const q = conversationQuery.trim() || undefined;
      runAiCommand('ai.conversation.list', { q }).then(list => setConversationList(list)).catch(() => {});
    } catch {
      /* swallow — list will refresh on next open */
    }
  }, [conversationQuery]);

  const saveConversation = useCallback((msgs: ChatMessage[], runningUsage: UsageMeter | null) => {
    if (msgs.length === 0) return;
    // Preserve title/pinned/systemPrompt from the existing list entry so
    // saving a turn doesn't clobber a user-set rename or pin (#127).
    const existing = conversationList.find(c => c.id === conversationId);
    const conv = {
      id: conversationId,
      title: existing?.title || msgs.find(m => m.role === 'user')?.text.slice(0, 60) || 'New conversation',
      messages: msgs.map(m => ({ ...m, timestamp: new Date().toISOString() })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(existing?.pinned ? { pinned: true } : {}),
      ...(systemPromptOverride.trim() ? { systemPrompt: systemPromptOverride.trim() } : {}),
      // #ai-export — record which standing system prompt this conversation ran under.
      ...(systemContextDigestRef.current ? { systemContextDigest: systemContextDigestRef.current } : {}),
      // #55 — persist chat mode so reopening this conversation restores
      // the same Designer / Ask / Review framing. Only emit when non-default.
      ...(mode !== 'designer' ? { mode } : {}),
      // Persist running totals so reopening the conversation restores
      // the meter chip (#128). totalCost is only set when pricing is
      // configured server-side.
      ...(runningUsage ? {
        usage: {
          inputTokens: runningUsage.inputTokens,
          outputTokens: runningUsage.outputTokens,
          ...(runningUsage.cost !== undefined ? { totalCost: runningUsage.cost } : {}),
        },
      } : {}),
    };
    runAiCommand('ai.conversation.save', { conversation: conv as any }).catch(() => {});
  }, [conversationId, conversationList, systemPromptOverride, mode]);

  const loadConversation = useCallback((id: string) => {
    runAiCommand('ai.conversation.get', { id }).then(d => {
      if (d) {
        setConversationId(d.id);
        systemContextDigestRef.current = (d as { systemContextDigest?: string }).systemContextDigest ?? null;
        setMessages((d.messages as any[]).map((m: any) => {
          // #228 — sweep stale in-flight tool states from a prior session
          // so cards don't keep spinning after a backend restart / page reload.
          if (m.role !== 'assistant' || !m.toolCalls?.length) return m;
          return {
            ...m,
            toolCalls: m.toolCalls.map((tc: any) =>
              tc.status === 'starting' || tc.status === 'running'
                ? { ...tc, status: 'cancelled' }
                : tc
            ),
          };
        }));
        // Restore the meter chip from the saved conversation (#128).
        // Older conversations saved before the meter shipped have no
        // `usage` key — clear the chip in that case.
        if (d.usage) {
          setUsage({
            inputTokens: d.usage.inputTokens || 0,
            outputTokens: d.usage.outputTokens || 0,
            ...(typeof d.usage.totalCost === 'number' ? { cost: d.usage.totalCost } : {}),
          });
        } else {
          setUsage(null);
        }
        // #127 — restore per-conversation system prompt override.
        setSystemPromptOverride(typeof d.systemPrompt === 'string' ? d.systemPrompt : '');
        setSystemPromptEditing(false);
        // #55 — restore chat mode; legacy conversations have no `mode`
        // field, fall back to Designer.
        setMode((d.mode === 'ask' || d.mode === 'review') ? d.mode : 'designer');
        setView('chat');
      }
    }).catch(() => {});
  }, []);

  const startNewConversation = useCallback(() => {
    setConversationId(crypto.randomUUID());
    systemContextDigestRef.current = null;
    setMessages([]);
    setUsage(null);
    setSystemPromptOverride('');
    setSystemPromptEditing(false);
    // #55 — reset chat mode to Designer so a new conversation doesn't
    // silently inherit the previous one's Ask / Review framing.
    setMode('designer');
    setView('chat');
  }, []);

  const deleteConversation = useCallback((id: string) => {
    runAiCommand('ai.conversation.delete', { id }).then(() => {
      setConversationList(prev => prev.filter(c => c.id !== id));
      if (id === conversationId) startNewConversation();
    }).catch(() => {});
  }, [conversationId, startNewConversation]);

  // Export a conversation as readable Markdown (#ai-export).
  const downloadConversationMd = useCallback((conv: Conversation, systemContext?: string | null) => {
    const blob = new Blob([conversationToMarkdown(conv, new Date(), systemContext || undefined)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = conversationFilename(conv);
    a.rel = 'noopener';
    // Anchor must be in the DOM for the click to trigger a download in some
    // browsers, and the object URL must NOT be revoked synchronously — that
    // cancels the download before the browser reads the blob.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, []);
  // History rows export the saved copy by id.
  const exportConversation = useCallback(async (id: string, withContext = false) => {
    try {
      const conv = (await runAiCommand('ai.conversation.get', { id })) as Conversation | null;
      if (!conv) return;
      let sys: string | null = null;
      if (withContext) {
        sys = conv.systemContextDigest
          ? ((await runAiCommand('ai.system-prompt.get', { digest: conv.systemContextDigest })) as string | null)
          : (conv.systemPrompt || null); // older conversations: fall back to the stored override
      }
      downloadConversationMd(conv, sys);
    } catch { /* export is best-effort */ }
  }, [downloadConversationMd]);
  // The header exports the current conversation from live state (always up to date).
  const exportCurrentConversation = useCallback(async (withContext = false) => {
    const title = conversationList.find(c => c.id === conversationId)?.title
      || messages.find(m => m.role === 'user')?.text?.slice(0, 60) || 'AI conversation';
    const digest = systemContextDigestRef.current;
    let sys: string | null = null;
    if (withContext) {
      sys = digest ? ((await runAiCommand('ai.system-prompt.get', { digest })) as string | null) : (systemPromptOverride || null);
    }
    downloadConversationMd({
      id: conversationId,
      title,
      messages: messages as unknown as Conversation['messages'],
      createdAt: '',
      updatedAt: new Date().toISOString(),
      mode,
      ...(digest ? { systemContextDigest: digest } : {}),
      ...(systemPromptOverride ? { systemPrompt: systemPromptOverride } : {}),
      usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, ...(usage.cost != null ? { totalCost: usage.cost } : {}) } : undefined,
    }, sys);
  }, [conversationId, conversationList, messages, mode, usage, systemPromptOverride, downloadConversationMd]);

  const toggleTool = (toolId: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId); else next.add(toolId);
      return next;
    });
  };

  const toggleRaw = (toolId: string) => {
    setRawShownTools(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId); else next.add(toolId);
      return next;
    });
  };

  // sendToAI accepts either a string (new user message appended to
  // the current history) or a pre-built history array (for retry /
  // edit-resend, where the caller has already truncated). The optional
  // `priorHistory` arg lets edit-resend pass its truncated history
  // synchronously instead of racing the setMessages updater. (#126)
  const sendToAI = useCallback(async (
    text: string,
    options?: { priorHistory?: ChatMessage[]; reuseUserMsgId?: string },
  ) => {
    const userMsg: ChatMessage = {
      id: options?.reuseUserMsgId ?? crypto.randomUUID(),
      role: 'user',
      text,
    };
    const baseHistory = options?.priorHistory ?? messages;
    setMessages([...baseHistory, userMsg]);
    setIsLoading(true);
    setError(null); setErrorDetails(null);
    // New user send unlocks auto-scroll: we want the viewport to
    // follow the response. (#126)
    setScrollLocked(false);
    setHasUnseenDeltas(false);

    // Set up an AbortController so the Stop button (and unmount) can
    // tear down the in-flight stream and break the agentic loop. (#61)
    const ac = new AbortController();
    abortControllerRef.current = ac;
    // Reset the per-turn streamId; populated when the backend emits
    // `start` (direct path) or `stream-id` (AI SDK path).
    streamIdRef.current = null;

    // Tool tracking: tools enter at `starting`, transition to `running`
    // when input arrives, and resolve to terminal state on output. We
    // keep an ordered list (insertion = arrival) plus a lookup map so
    // ordering across tool-input-start/-available/-output-available is
    // stable per distinct toolCallId (#131 makes ids real).
    const toolOrder: string[] = [];
    const toolMap: Record<string, ToolCall> = {};
    const rawEvents: any[] = [];
    let assistantText = '';
    const assistantId = crypto.randomUUID();
    let cancelled = false;
    // #63 — populated when the backend emits a `condensed` SSE event
    // before the model's response. Rendered as a pill above the bubble.
    let condensedInfo: { count: number; estimatedTokens?: number } | null = null;
    // #192 — populated when the backend emits a `step-limit-reached` SSE
    // event (the agentic loop hit its step budget). Rendered as a visible,
    // non-error info pill below the bubble.
    let stepLimitInfo: { limit: number } | null = null;
    // #confab-guard — populated when the backend emits a `no-op-warning` SSE
    // event (model claimed a change but no mutating tool succeeded). Rendered
    // as a visible warning pill below the bubble.
    let noOpWarning: string | null = null;
    // Per-turn usage payload (#128). Backend emits one `usage` SSE
    // event before `done`; we accumulate it onto the running meter
    // and persist with the conversation in the finally block.
    let turnUsage: { inputTokens: number; outputTokens: number; cost?: number } | null = null;

    // #64 — capture autonomous-mode at the start of the stream so a mid-
    // run toggle doesn't retroactively change which past turns are
    // marked autonomous.
    const turnAutonomous = autonomous;
    const pushToolUpdate = () => {
      const toolCalls = toolOrder.map(id => toolMap[id]).filter(Boolean);
      setMessages(prev => {
        const existing = prev.find(m => m.id === assistantId);
        if (existing) {
          return prev.map(m => m.id === assistantId
            ? {
                ...m,
                text: assistantText,
                toolCalls: [...toolCalls],
                rawEvents: [...rawEvents],
                cancelled,
                ...(condensedInfo ? { condensed: condensedInfo } : {}),
                ...(stepLimitInfo ? { stepLimit: stepLimitInfo } : {}),
                ...(noOpWarning ? { noOpWarning } : {}),
                ...(turnAutonomous ? { autonomous: true } : {}),
                ...(streamIdRef.current ? { streamId: streamIdRef.current } : {}),
              }
            : m);
        }
        return [...prev, {
          id: assistantId,
          role: 'assistant',
          text: assistantText,
          toolCalls: [...toolCalls],
          rawEvents: [...rawEvents],
          cancelled,
          ...(condensedInfo ? { condensed: condensedInfo } : {}),
          ...(stepLimitInfo ? { stepLimit: stepLimitInfo } : {}),
          ...(turnAutonomous ? { autonomous: true } : {}),
          ...(streamIdRef.current ? { streamId: streamIdRef.current } : {}),
        }];
      });
    };

    // Mark any in-flight tool cards as cancelled so the spinner stops and
    // the saved conversation isn't corrupted with stuck `running` tools. (#61)
    const sweepInflightTools = () => {
      for (const id of toolOrder) {
        const t = toolMap[id];
        if (t && (t.status === 'starting' || t.status === 'running')) {
          toolMap[id] = { ...t, status: 'cancelled' };
        }
      }
    };

    // Delta coalescing: text-delta events arrive token-by-token.
    // We append into a buffer and flush on a ~50ms timer rather than
    // calling setState per token. (#126)
    const flushDeltas = () => {
      if (!deltaBufferRef.current) return;
      assistantText += deltaBufferRef.current;
      deltaBufferRef.current = '';
      pushToolUpdate();
    };
    const scheduleDeltaFlush = () => {
      if (deltaFlushTimerRef.current != null) return;
      deltaFlushTimerRef.current = setTimeout(() => {
        deltaFlushTimerRef.current = null;
        flushDeltas();
      }, DELTA_FLUSH_INTERVAL_MS);
    };
    const cancelDeltaFlush = () => {
      if (deltaFlushTimerRef.current != null) {
        clearTimeout(deltaFlushTimerRef.current);
        deltaFlushTimerRef.current = null;
      }
    };

    // Track which gated tool calls we've already resolved (auto-approved or
    // marked pending) so the start + available events for the same call
    // don't double-decide. Keyed by toolCallId.
    const gatedDecided = new Set<string>();

    // The backend BLOCKS gated tool executors (create/modify/delete) on a
    // server-side approval gate. The moment a gated tool's input arrives we
    // must either auto-approve it (so the stream unblocks immediately) or
    // mark its card `pending` and wait for the human. Reads/navigation are
    // never gated, so they're ignored here. Returns true when the card was
    // flipped to `pending` (caller renders the review controls).
    const decideGatedTool = (toolCallId: string, category: AIToolCategory | undefined): boolean => {
      if (!category || gatedDecided.has(toolCallId)) return false;
      // Only create/modify/delete are gated server-side.
      if (category !== 'create' && category !== 'modify' && category !== 'delete') return false;
      const streamId = streamIdRef.current;
      // No streamId means the backend isn't gating this stream (older
      // backend). Fall back to the post-stream policy pass — don't decide
      // mid-stream, since the tool's output will arrive without a gate.
      if (!streamId) return false;
      gatedDecided.add(toolCallId);
      // #64 — autonomous mode auto-approves everything except delete.
      const autoApprove =
        shouldAutoApprove(policy, category) || (turnAutonomous && category !== 'delete');
      if (autoApprove) {
        // Fire-and-forget the approval so the backend executor unblocks
        // without any user interaction.
        runAiCommand('ai.chat.approve', { streamId, toolCallId, decision: 'approve' }).catch(() => {});
        return false;
      }
      // Human review required: hold the card in `pending`. The backend
      // executor stays parked until the user clicks Approve / Reject, which
      // POSTs the decision via the per-card handlers.
      if (toolMap[toolCallId]) {
        toolMap[toolCallId] = { ...toolMap[toolCallId], status: 'pending' };
        pushToolUpdate();
        setPendingReview(true);
      }
      return true;
    };

    try {
      const allMessages = [...baseHistory, userMsg];
      const apiMessages = allMessages.map(m => ({
        id: m.id,
        role: m.role,
        parts: [{ type: 'text', text: m.text }],
        // #confab-fix — carry prior tool calls + their results so the model sees
        // that it ACTUALLY called tools (and what they returned) in earlier
        // turns, instead of just its own confirmation prose. Without this the
        // model imitates "respond to a create request = write text" and skips
        // the tool call. Only completed, non-discarded calls.
        ...(m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length
          ? {
              toolCalls: m.toolCalls
                .filter(tc => tc && tc.output !== undefined && tc.status !== 'cancelled' && tc.status !== 'undone')
                .map(tc => ({ id: tc.id, name: tc.name, input: tc.input, output: tc.output })),
            }
          : {}),
      }));

      const shouldSendContext = includePageContext && pageContext.length > 0;
      const trimmedSystemPrompt = systemPromptOverride.trim();
      const chatRequest = {
        messages: apiMessages,
        ...(shouldSendContext ? { pageContext } : {}),
        // #127 — per-conversation override of SYSTEM_PROMPT, scoped to this turn.
        ...(trimmedSystemPrompt ? { systemPrompt: trimmedSystemPrompt } : {}),
        // #55 — only send `mode` when it's not the default; keeps
        // the request payload identical to pre-#55 for the common case.
        ...(mode !== 'designer' ? { mode } : {}),
      };
      const response = await runAiCommand('ai.chat.send', { request: chatRequest as any, signal: ac.signal });

      if (!response.ok) {
        const responseText = await response.text();
        let responseError: any = {};
        try { responseError = JSON.parse(responseText); } catch { /* non-JSON server/proxy response */ }
        const message = responseError.message || responseText || `AI request failed (${response.status})`;
        setErrorDetails({
          upstreamStatus: response.status,
          providerRaw: responseText || undefined,
          diagnostics: responseError.diagnostics && typeof responseError.diagnostics === 'object'
            ? { serverResponse: responseError.diagnostics }
            : { serverResponse: { status: response.status, statusText: response.statusText } },
        });
        throw new Error(message);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));
            rawEvents.push(data);

            // Capture the per-turn streamId so tool-approval POSTs can
            // target this stream. Direct path emits it on `start`; the AI
            // SDK path emits a dedicated `stream-id` event after headers.
            // #ai-export — the backend persisted the standing system prompt and sent
            // its digest; remember it so this conversation records what it ran under.
            if (data.type === 'system-context' && typeof data.digest === 'string') {
              systemContextDigestRef.current = data.digest;
              continue;
            }

            if ((data.type === 'start' || data.type === 'stream-id') && typeof data.streamId === 'string') {
              streamIdRef.current = data.streamId;
              continue;
            }

            if (data.type === 'cancelled') {
              cancelled = true;
              sweepInflightTools();
              pushToolUpdate();
              continue;
            }

            // Backend forwards upstream provider errors with structured
            // fields (#150 follow-up). Surface the human message in the
            // error banner; raw upstream JSON stays in rawEvents for
            // power users.
            if (data.type === 'error') {
              const friendly = (typeof data.providerMessage === 'string' && data.providerMessage)
                || (typeof data.errorText === 'string' && data.errorText)
                || 'AI request failed';
              setError(friendly);
              setErrorDetails({
                upstreamStatus: typeof data.upstreamStatus === 'number' ? data.upstreamStatus : undefined,
                providerMessage: typeof data.providerMessage === 'string' ? data.providerMessage : undefined,
                providerCode: data.providerCode,
                providerHelpUrl: typeof data.providerHelpUrl === 'string' ? data.providerHelpUrl : undefined,
                providerRaw: typeof data.providerRaw === 'string' ? data.providerRaw : undefined,
                diagnostics: data.diagnostics && typeof data.diagnostics === 'object'
                  ? data.diagnostics as Record<string, unknown>
                  : undefined,
              });
              continue;
            }

            // #63 — backend signals it summarized older history before
            // forwarding to the model. Stash the info; the assistant
            // message will render a pill in its bubble.
            if (data.type === 'condensed') {
              condensedInfo = {
                count: Number(data.condensedCount) || 0,
                ...(typeof data.estimatedTokens === 'number' ? { estimatedTokens: data.estimatedTokens } : {}),
              };
              pushToolUpdate();
              continue;
            }

            // #192 — backend signals the agentic loop stopped because it
            // hit its step budget (not a natural finish). Stash the limit;
            // the assistant message renders a visible info pill. The model's
            // summary of progress arrived as normal text above.
            if (data.type === 'step-limit-reached') {
              stepLimitInfo = { limit: Number(data.limit) || 0 };
              pushToolUpdate();
              continue;
            }

            // #confab-guard — backend detected the model claimed a change but
            // no create/update/delete actually succeeded this turn. Render a
            // visible warning so a false "Done!" doesn't read as real.
            if (data.type === 'no-op-warning') {
              noOpWarning = typeof data.message === 'string' && data.message
                ? data.message
                : 'The assistant said it made changes, but nothing was actually saved this turn.';
              pushToolUpdate();
              continue;
            }

            if (data.type === 'usage') {
              // Stash the per-turn usage; it's applied to the running
              // meter in the finally block so we update once per turn
              // instead of mid-stream. (#128)
              turnUsage = {
                inputTokens: Number(data.inputTokens) || 0,
                outputTokens: Number(data.outputTokens) || 0,
                ...(typeof data.cost === 'number' ? { cost: data.cost } : {}),
              };
              continue;
            }

            if (data.type === 'text-delta' && data.delta) {
              deltaBufferRef.current += data.delta;
              scheduleDeltaFlush();
            }

            if (data.type === 'tool-input-start' && data.toolCallId) {
              // Tool events represent a structural change; flush any
              // pending text first so ordering is preserved. (#126)
              cancelDeltaFlush();
              flushDeltas();
              if (!toolMap[data.toolCallId]) {
                toolMap[data.toolCallId] = {
                  id: data.toolCallId,
                  name: data.toolName || data.toolCallId,
                  input: null,
                  output: null,
                  status: 'starting',
                  // Backend-emitted category (#59). Used to drive both the
                  // per-card pill and the auto-approve decision below.
                  category: data.category as AIToolCategory | undefined,
                };
                toolOrder.push(data.toolCallId);
                pushToolUpdate();
              }
              // Server-side gate decision (#approval-gate). For gated
              // categories, either auto-approve now (unblock the executor)
              // or mark the card pending for human review.
              decideGatedTool(data.toolCallId, data.category as AIToolCategory | undefined);
            }

            if (data.type === 'tool-input-available' && data.toolCallId) {
              if (!toolMap[data.toolCallId]) {
                toolMap[data.toolCallId] = {
                  id: data.toolCallId,
                  name: data.toolName || data.toolCallId,
                  input: data.input,
                  output: null,
                  status: 'running',
                  category: data.category as AIToolCategory | undefined,
                };
                toolOrder.push(data.toolCallId);
              } else {
                toolMap[data.toolCallId] = {
                  ...toolMap[data.toolCallId],
                  name: data.toolName || toolMap[data.toolCallId].name,
                  input: data.input,
                  // Don't clobber a `pending` gate set by tool-input-start —
                  // a review-gated tool must stay pending until the human
                  // decides; only advance a still-`starting` card to running.
                  status: toolMap[data.toolCallId].status === 'pending'
                    ? 'pending'
                    : 'running',
                  // Prefer the existing category (set by tool-input-start)
                  // but accept the available event's value if it's the
                  // first time we're seeing it.
                  category: toolMap[data.toolCallId].category ?? (data.category as AIToolCategory | undefined),
                };
              }
              pushToolUpdate();
              // Decide the gate as soon as input is available. If tool-input-start
              // already decided this call, `gatedDecided` makes this a no-op.
              decideGatedTool(
                data.toolCallId,
                (toolMap[data.toolCallId]?.category) ?? (data.category as AIToolCategory | undefined),
              );
            }

            if (data.type === 'tool-output-available' && data.toolCallId) {
              // A user-denied gated tool comes back with `denied:true` from
              // the backend (the real executor never ran). Resolve its card
              // to the terminal `undone` (rejected) state rather than a plain
              // terminal-good state. Otherwise resolve normally.
              const isDenied = data.output && data.output.denied === true;
              const terminalStatus = isDenied ? ('undone' as const) : undefined;
              if (!toolMap[data.toolCallId]) {
                toolMap[data.toolCallId] = {
                  id: data.toolCallId,
                  name: data.toolCallId,
                  input: null,
                  output: data.output,
                  status: terminalStatus,
                };
                toolOrder.push(data.toolCallId);
              } else {
                toolMap[data.toolCallId] = {
                  ...toolMap[data.toolCallId],
                  output: data.output,
                  status: terminalStatus,
                };
              }
              pushToolUpdate();

              if (data.output?.navigate) {
                // Validate the CLEAN path (validateNavigatePath rejects query
                // strings). Only after it passes do we append the highlight
                // hint so the destination can flash the changed element (#191).
                const check = validateNavigatePath(data.output.navigate);
                if (check.valid) {
                  const highlight = data.output.highlight;
                  const dest = highlight
                    ? `${data.output.navigate}?highlight=${encodeURIComponent(highlight)}`
                    : data.output.navigate;
                  navigate(dest);
                } else {
                  // Suppress the navigation, rewrite the tool output so the
                  // AI sees the failure on its next turn and can self-correct
                  // (rather than landing the user on the 404 page).
                  const errorOutput = {
                    ...data.output,
                    success: false,
                    error: check.reason,
                    knownRoots: check.knownRoots,
                    navigate: undefined,
                  };
                  toolMap[data.toolCallId] = {
                    ...toolMap[data.toolCallId],
                    output: errorOutput,
                    status: undefined,
                  };
                  pushToolUpdate();
                }
              }
            }

            // #190 — the AI SDK emits `tool-output-error` (not
            // `tool-output-available`) when a tool's `execute` throws or the
            // model passes args that fail the input schema. Resolve the card
            // to a terminal error state so it renders as the red ✗ card
            // (renderer keys off `output.success === false`) instead of a
            // perpetual spinner. Handles both an existing card and an error
            // that arrives without a prior `tool-input-*` event.
            if (data.type === 'tool-output-error' && data.toolCallId) {
              const prev = toolMap[data.toolCallId];
              toolMap[data.toolCallId] = {
                ...(prev ?? { id: data.toolCallId, name: data.toolCallId, input: null, category: undefined }),
                output: { success: false, error: data.errorText || 'Tool execution failed' },
                status: undefined,
              };
              if (!prev) toolOrder.push(data.toolCallId);
              pushToolUpdate();
              continue;
            }
          } catch {
            // Skip
          }
        }
      }

      // Stream complete: flush any remaining buffered deltas before we
      // synthesize fallback text or save the conversation. (#126)
      cancelDeltaFlush();
      flushDeltas();

      // #190 — defensive backstop: settle any tool still in
      // `starting`/`running` (e.g. a terminal event that never arrived) to a
      // terminal `cancelled` state so it can't dangle as a spinner or be
      // persisted into the saved conversation.
      sweepInflightTools();

      const toolCalls = toolOrder.map(id => toolMap[id]).filter(Boolean);

      // Ensure assistant message exists with sensible default text
      if (!assistantText && toolCalls.length > 0) {
        assistantText = toolCalls.map(t => {
          if (t.output?.success === false && t.output?.error) return `**Error in ${t.name}:** ${t.output.error}`;
          // generateMermaid → render the diagram (the markdown code override
          // turns a ```mermaid block into an SVG), even with no model prose.
          if (typeof t.output?.mermaid === 'string') return `\`\`\`mermaid\n${t.output.mermaid}\n\`\`\``;
          if (typeof t.output === 'string') return t.output;
          // Prefer the canonical structured `summary` over legacy `message` (#191).
          if (t.output?.summary) return `- ${t.output.summary}`;
          if (t.output?.message) return `- ${t.output.message}`;
          if (t.output?.packages) return `**Packages:** ${t.output.packages.join(', ')}`;
          if (t.output?.entities) return `Found **${t.output.entities.length}** entities`;
          if (t.output?.stereotypes) return t.output.stereotypes.map((s: any) => `- **${s.name}** (${s.appliesTo}): ${s.fields?.join(', ') || ''}`).join('\n');
          return `\`\`\`json\n${JSON.stringify(t.output, null, 2)}\n\`\`\``;
        }).join('\n\n');
        pushToolUpdate();
      } else if (!assistantText && !cancelled) {
        assistantText = '*(No response)*';
        pushToolUpdate();
      } else if (cancelled && !assistantText) {
        assistantText = '*(Cancelled)*';
        pushToolUpdate();
      }

      // Apply per-category auto-approve policy (#59) — fallback for streams
      // that DIDN'T go through the server-side gate (no streamId / older
      // backend). When the backend gated a tool, `gatedDecided` already
      // resolved it mid-stream (auto-approved or held pending), so we skip
      // it here to avoid re-flipping. Tools in `review` categories are
      // flipped to status='pending'; `auto` categories keep their terminal
      // state. We only override terminal-good states.
      if (toolCalls.length > 0) {
        let anyPending = false;
        const adjusted = toolCalls.map(tc => {
          // Already decided by the server-side gate this turn — leave as-is.
          if (gatedDecided.has(tc.id)) return tc;
          // Don't second-guess non-terminal-good states.
          const isTerminalNonOk =
            tc.status === 'undone' ||
            tc.status === 'cancelled' ||
            (tc.output && tc.output.success === false);
          if (isTerminalNonOk) return tc;
          // #64 — autonomous mode bypasses the per-category review gate
          // for everything except `delete` (which can never be auto-approved
          // by design — see getEffectivePolicy).
          if (autonomous && tc.category !== 'delete') return tc;
          if (shouldAutoApprove(policy, tc.category)) return tc;
          anyPending = true;
          return { ...tc, status: 'pending' as const };
        });
        if (anyPending) {
          // Update both the snapshot and the message store so the UI
          // reflects the post-policy state immediately.
          for (const tc of adjusted) toolMap[tc.id] = tc;
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, toolCalls: adjusted } : m));
          setPendingReview(true);
        }
      }

      // Soft sidebar refresh after the turn fully settles. Fires only when a
      // real mutation executed (not denied, not a read), and only here — after
      // the stream is consumed — so it can never abort the in-flight SSE the
      // way a mid-stream reload would. No `window.location.reload()`.
      const mutated = toolCalls.some(tc =>
        (tc.category === 'create' || tc.category === 'modify' || tc.category === 'delete') &&
        tc.output && tc.output.success !== false && !tc.output.denied);
      if (mutated) {
        window.dispatchEvent(new CustomEvent('app:data-changed'));
      }
    } catch (err: any) {
      // Flush any buffered deltas so partial assistant text isn't lost
      // when the stream errors or is aborted. (#126)
      cancelDeltaFlush();
      flushDeltas();
      if (err?.name === 'AbortError' || ac.signal.aborted) {
        // User cancelled — surface a friendly note rather than an error,
        // and stop any in-flight tool spinners so the saved conversation
        // doesn't carry a perpetual `running` card. (#61)
        cancelled = true;
        sweepInflightTools();
        if (!assistantText) {
          assistantText = '*(Cancelled)*';
        }
        pushToolUpdate();
      } else {
        setError(err.message);
      }
    } finally {
      if (abortControllerRef.current === ac) abortControllerRef.current = null;
      setIsLoading(false);
      // Aggregate the turn usage onto the running meter and persist it
      // with the conversation. We capture the new totals synchronously
      // here so saveConversation gets the post-turn numbers without a
      // second render cycle. (#128)
      let nextUsage: UsageMeter | null = null;
      setUsage(prev => {
        if (!turnUsage) {
          nextUsage = prev;
          return prev;
        }
        const merged: UsageMeter = {
          inputTokens: (prev?.inputTokens || 0) + turnUsage.inputTokens,
          outputTokens: (prev?.outputTokens || 0) + turnUsage.outputTokens,
        };
        // Sum cost only when both sides report it; otherwise preserve
        // whichever side has a number so an early "no pricing" turn
        // doesn't clobber a later priced turn.
        const prevCost = prev?.cost;
        const turnCost = turnUsage.cost;
        if (typeof turnCost === 'number' || typeof prevCost === 'number') {
          merged.cost = (prevCost || 0) + (turnCost || 0);
        }
        nextUsage = merged;
        return merged;
      });
      setMessages(msgs => { saveConversation(msgs, nextUsage); return msgs; });
    }
  }, [messages, navigate, saveConversation, policy, includePageContext, pageContext, autonomous, mode]);

  // #sql-error-to-agent — the Run modal / SQL Console (#205) post a failed query
  // + its DB error here; feed it into the conversation so the agent sees the
  // failure and replies with a corrected read-only query (its ```sql block gets
  // its own ▶ Run button). Shared channel: both surfaces dispatch this event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { sql?: string; error?: string; packageName?: string } | undefined;
      const sql = detail?.sql?.trim();
      const error = detail?.error?.trim();
      if (!sql || !error) return;
      const where = detail?.packageName ? `the \`${detail.packageName}\` database` : 'the package database';
      const msg = [
        `I ran this SQL against ${where} and it failed.`,
        '',
        '**Error**',
        '```',
        error,
        '```',
        '',
        '**Failed query**',
        '```sql',
        sql,
        '```',
        '',
        'Explain the cause briefly, then provide a corrected single read-only SELECT as a SQL code block.',
      ].join('\n');
      window.dispatchEvent(new CustomEvent('ai-chat:open')); // reveal the panel (e.g. when triggered from the console)
      void sendToAI(msg);
    };
    window.addEventListener('ai-chat:sql-error', handler);
    return () => window.removeEventListener('ai-chat:sql-error', handler);
  }, [sendToAI]);

  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // Resolve the server-side gate for one pending tool. The POST is what
  // actually matters — it unblocks (or rejects) the backend executor; the
  // local status flip is just immediate UI feedback while the backend runs
  // the tool and the `tool-output-available` event settles the card.
  const resolveGatedTool = useCallback(async (
    msgId: string,
    toolId: string,
    decision: 'approve' | 'deny',
  ) => {
    const msg = messages.find(m => m.id === msgId);
    const streamId = msg?.streamId ?? streamIdRef.current ?? null;
    if (streamId) {
      try {
        await runAiCommand('ai.chat.approve', { streamId, toolCallId: toolId, decision });
      } catch { /* gate may already be gone; fall through to UI flip */ }
    }
    setMessages(prev => prev.map(m => {
      if (m.id === msgId && m.toolCalls) {
        const next = decision === 'approve' ? ('approved' as const) : ('undone' as const);
        const updated = m.toolCalls.map(t => t.id === toolId ? { ...t, status: next } : t);
        const anyStillPending = updated.some(t => t.status === 'pending');
        if (!anyStillPending) setPendingReview(false);
        return { ...m, toolCalls: updated };
      }
      return m;
    }));
  }, [messages]);

  const approveToolCall = useCallback((msgId: string, toolId: string) => {
    void resolveGatedTool(msgId, toolId, 'approve');
  }, [resolveGatedTool]);

  const rejectToolCall = useCallback((msgId: string, toolId: string) => {
    void resolveGatedTool(msgId, toolId, 'deny');
  }, [resolveGatedTool]);

  const approveAllTools = useCallback((msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    const streamId = msg?.streamId ?? streamIdRef.current ?? null;
    const pendingIds = (msg?.toolCalls ?? []).filter(tc => tc.status === 'pending').map(tc => tc.id);
    // POST approve for every pending tool so the backend executors unblock.
    if (streamId) {
      for (const toolId of pendingIds) {
        runAiCommand('ai.chat.approve', { streamId, toolCallId: toolId, decision: 'approve' }).catch(() => {});
      }
    }
    setMessages(prev => prev.map(m => {
      if (m.id === msgId && m.toolCalls) {
        return {
          ...m,
          toolCalls: m.toolCalls.map(tc =>
            tc.status === 'pending' ? { ...tc, status: 'approved' as const } : tc),
        };
      }
      return m;
    }));
    setPendingReview(false);
    // No page reload here: the tools are still executing server-side and the
    // SSE stream is in flight. Reloading would abort the fetch, deny sibling
    // parked tool calls, and truncate the turn. The sidebar is refreshed once
    // the stream completes (see the post-stream soft refresh).
  }, [messages]);

  const undoToolCall = useCallback(async (msgId: string, toolId: string) => {
    const msg = messages.find(m => m.id === msgId);
    const tc = msg?.toolCalls?.find(t => t.id === toolId);
    if (!tc?.output?.navigate) return;

    // Extract package and entity from navigate path: /packages/{pkg}/entities/{entity}
    const match = tc.output.navigate.match(/\/packages\/([^/]+)\/entities\/([^/]+)/);
    if (match) {
      try {
        await fetch(`/api/services/${match[1]}/entities/${match[2]}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer mock-token-for-testing' },
        });
      } catch { /* ok */ }
    }

    setMessages(prev => prev.map(m => {
      if (m.id === msgId && m.toolCalls) {
        const updated = m.toolCalls.map(t => t.id === toolId ? { ...t, status: 'undone' as const } : t);
        const allResolved = updated.every(t => t.status === 'approved' || t.status === 'undone');
        if (allResolved) setPendingReview(false);
        return { ...m, toolCalls: updated };
      }
      return m;
    }));
  }, [messages]);

  const toggleIncludePageContext = useCallback((val: boolean) => {
    setIncludePageContext(val);
    localStorage.setItem('ai-include-page-context', String(val));
  }, []);


  // Load tool definitions on mount. Eager (not gated on the Tools
  // view) because the chat-card render needs the catalog to attribute
  // MCP tool calls to their source connection (#178 slice 3) — by the
  // time a tool-input-start event arrives we have to already know
  // which entries are `source: 'mcp'` and what label to render.
  useEffect(() => {
    if (toolDefs.length === 0) {
      runAiCommand('ai.tools.list').then(tools => setToolDefs(tools)).catch(() => {});
    }
  }, []);

  // --- Saved prompts (#123) ---
  const refreshPrompts = useCallback(() => {
    runAiCommand('ai.prompt.list')
      .then(prompts => setPrompts(prompts))
      .catch(() => {});
  }, []);

  // Lazy-load prompts the first time the user opens the prompts view.
  useEffect(() => {
    if (view === 'prompts') refreshPrompts();
  }, [view, refreshPrompts]);

  const startNewPromptDraft = useCallback((seed: string = '') => {
    setEditingPromptId(null);
    setPromptNameDraft('');
    setPromptContentDraft(seed);
    setPromptError(null);
  }, []);

  const startEditPrompt = useCallback((p: SavedPrompt) => {
    setEditingPromptId(p.id);
    setPromptNameDraft(p.name);
    setPromptContentDraft(p.content);
    setPromptError(null);
  }, []);

  const cancelPromptDraft = useCallback(() => {
    setEditingPromptId(null);
    setPromptNameDraft('');
    setPromptContentDraft('');
    setPromptError(null);
  }, []);

  const savePromptDraft = useCallback(async () => {
    const name = promptNameDraft.trim();
    if (!name) {
      setPromptError('Name is required');
      return;
    }
    if (!promptContentDraft.trim()) {
      setPromptError('Content is required');
      return;
    }
    try {
      const isUpdate = editingPromptId !== null;
      if (isUpdate) {
        await runAiCommand('ai.prompt.update', { id: editingPromptId!, name, content: promptContentDraft });
      } else {
        await runAiCommand('ai.prompt.create', { name, content: promptContentDraft });
      }
      cancelPromptDraft();
      refreshPrompts();
    } catch (e: any) {
      setPromptError(e.message || 'Save failed');
    }
  }, [editingPromptId, promptNameDraft, promptContentDraft, cancelPromptDraft, refreshPrompts]);

  const deletePrompt = useCallback(async (id: string) => {
    try {
      await runAiCommand('ai.prompt.delete', { id });
      if (editingPromptId === id) cancelPromptDraft();
      refreshPrompts();
    } catch {
      // Ignore — list will refresh on next view
    }
  }, [editingPromptId, cancelPromptDraft, refreshPrompts]);

  const insertPromptIntoComposer = useCallback((p: SavedPrompt) => {
    setInput(p.content);
    setView('chat');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const saveCurrentInputAsPrompt = useCallback(() => {
    const seed = input;
    setView('prompts');
    startNewPromptDraft(seed);
  }, [input, startNewPromptDraft]);

  // #57 — fetch the existing entity for a `createEntity` tool call that
  // failed because the entity already exists. Stores both sides so the
  // diff renderer can show added / removed / modified attributes.
  const loadEntityDiff = useCallback(async (toolCallId: string, packageName: string, entityName: string, proposed: any) => {
    setEntityDiffs(prev => ({ ...prev, [toolCallId]: 'loading' }));
    try {
      const res = await fetch(`/api/services/${encodeURIComponent(packageName)}/entities/${encodeURIComponent(entityName)}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const existing = await res.json();
      setEntityDiffs(prev => ({ ...prev, [toolCallId]: { existing, proposed } }));
    } catch {
      setEntityDiffs(prev => ({ ...prev, [toolCallId]: 'error' }));
    }
  }, []);

  // #54 — extract the partial @-token at the cursor (or null if none).
  // Token rules: starts with `@`, followed by a word char, no whitespace,
  // 0..29 chars after the `@` (matching the backend's name regex).
  const extractMentionToken = useCallback((value: string, cursor: number): string | null => {
    const before = value.slice(0, cursor);
    const m = before.match(/(?:^|\s)@([A-Za-z][\w-]{0,29})$/);
    return m ? m[1] : null;
  }, []);

  const handleComposerChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setInput(v);
    const cursor = e.target.selectionStart ?? v.length;
    const token = extractMentionToken(v, cursor);
    setMentionToken(token);
    if (token === null) {
      setMentionResults({ entities: [], packages: [] });
    }
    // #56 — slash command picker triggers only at the very start of
    // the input (mid-line slashes are paths / dates, not commands).
    setSlashToken(extractSlashToken(v));
  }, [extractMentionToken]);

  // Debounced fetch for mention candidates.
  useEffect(() => {
    if (mentionToken === null || mentionToken.length === 0) return;
    const handle = setTimeout(() => {
      runAiCommand('ai.mentions.search', { q: mentionToken })
        .then(result => setMentionResults(result))
        .catch(() => {});
    }, 120);
    return () => clearTimeout(handle);
  }, [mentionToken]);

  // #56 — apply a slash command from the palette. Prompt commands replace
  // the input with the expanded template (the user can edit before sending);
  // local commands (only `/help` for now) inject a synthetic assistant
  // message inline without contacting the AI. In both cases the slash
  // token state is cleared so the picker hides.
  const applySlashCommand = useCallback((cmd: SlashCommand) => {
    setSlashToken(null);
    if (cmd.kind === 'local' && cmd.name === 'help') {
      // Render `/help` as a fake user/assistant pair so it shows up in
      // the conversation thread without burning a real model turn.
      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text: '/help' };
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: buildHelpMessage() };
      setMessages(prev => [...prev, userMsg, assistantMsg]);
      setInput('');
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    const expanded = expandTemplate(cmd.template, pageContext);
    setInput(expanded);
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(expanded.length, expanded.length);
    }, 0);
  }, [pageContext]);

  // Replace the partial `@xxx` at the cursor with `@<name>` and close the picker.
  const insertMention = useCallback((name: string) => {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? input.length;
    const before = input.slice(0, cursor);
    const after = input.slice(cursor);
    const replaced = before.replace(/(^|\s)@([A-Za-z][\w-]{0,29})$/, (_m, lead) => `${lead}@${name} `);
    const next = replaced + after;
    setInput(next);
    setMentionToken(null);
    setMentionResults({ entities: [], packages: [] });
    // Restore focus and place cursor right after the inserted mention.
    setTimeout(() => {
      el.focus();
      const pos = replaced.length;
      el.setSelectionRange(pos, pos);
    }, 0);
  }, [input]);

  // Auto-scroll lock (#126):
  // - When the user is at the bottom (within SCROLL_LOCK_THRESHOLD_PX),
  //   auto-scroll on every message update.
  // - When they've scrolled up, do NOT yank the viewport on incoming
  //   text-delta events; instead surface a "↓ New messages" pill so
  //   they can choose to jump back.
  useEffect(() => {
    if (scrollLocked) {
      // User is reading earlier content; mark that new content has
      // arrived so we can render the pill, but don't scroll.
      if (isLoading) setHasUnseenDeltas(true);
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, scrollLocked, isLoading]);

  // Watch the messages container for scroll position to flip the
  // scroll-lock state. We use a ref handler rather than React onScroll
  // so unit tests can fire scroll events on the DOM node directly.
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distanceFromBottom <= SCROLL_LOCK_THRESHOLD_PX;
      setScrollLocked(prev => {
        // Going from locked → unlocked clears the unseen-deltas badge.
        if (prev && atBottom) setHasUnseenDeltas(false);
        return !atBottom;
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [open, view]);

  const jumpToBottom = useCallback(() => {
    setScrollLocked(false);
    setHasUnseenDeltas(false);
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendToAI(input.trim());
    setInput('');
  };

  // === #126 retry / edit handlers ===

  // Retry the last user message: trim everything from the last user
  // turn onward and re-issue the request. Useful after a failed
  // request or a cancelled run.
  const retryLast = useCallback(() => {
    if (isLoading) return;
    // Find the most recent user message.
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const lastUserMsg = messages[lastUserIdx];
    const priorHistory = messages.slice(0, lastUserIdx);
    setError(null); setErrorDetails(null);
    sendToAI(lastUserMsg.text, { priorHistory, reuseUserMsgId: lastUserMsg.id });
  }, [messages, isLoading, sendToAI]);

  const beginEdit = useCallback((msgId: string) => {
    if (isLoading) return;
    const msg = messages.find(m => m.id === msgId);
    if (!msg || msg.role !== 'user') return;
    setEditingMsgId(msgId);
    setEditDraft(msg.text);
  }, [messages, isLoading]);

  const cancelEdit = useCallback(() => {
    setEditingMsgId(null);
    setEditDraft('');
  }, []);

  // Save an edited user message: truncate everything *after* it,
  // replace its text with the draft, then re-issue. Persistence
  // reflects the truncation because saveConversation runs in the
  // sendToAI finally block with the new (shorter) message list.
  const saveEditAndResend = useCallback(() => {
    if (!editingMsgId) return;
    const text = editDraft.trim();
    if (!text || isLoading) return;
    const idx = messages.findIndex(m => m.id === editingMsgId);
    if (idx === -1) return;
    const priorHistory = messages.slice(0, idx);
    const reuseUserMsgId = messages[idx].id;
    setEditingMsgId(null);
    setEditDraft('');
    setError(null); setErrorDetails(null);
    sendToAI(text, { priorHistory, reuseUserMsgId });
  }, [editingMsgId, editDraft, messages, isLoading, sendToAI]);

  // Global ⌘K / Ctrl-K — open the panel (delegated to parent via
  // onClose-toggle isn't possible since we're a child, so we focus
  // the composer when already open and emit a custom event the shell
  // can listen for to toggle open state). The shell already wires a
  // window event for `app:data-changed`; we use a similar pattern.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCmd = e.metaKey || e.ctrlKey;
      if (!isCmd) return;
      if (e.key !== 'k' && e.key !== 'K') return;
      // Don't hijack browser-native combinations.
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      if (open) {
        inputRef.current?.focus();
      } else {
        window.dispatchEvent(new CustomEvent('ai-chat:open'));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const handleComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘↵ / Ctrl↵ → send. ⇧↵ → newline (default textarea behaviour).
    // Plain ↵ also sends — matches typical chat UI.
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendToAI(input.trim());
    setInput('');
  };

  if (!open) return null;

  const selectedRaw = selectedMsgId ? messages.find(m => m.id === selectedMsgId)?.rawEvents : null;

  return (
    <div className="fixed right-0 top-10 bottom-0 bg-base-100 border-l border-base-300 shadow-xl z-40 flex flex-col font-mono text-[13px]" style={{ width: panelWidth }}>
      {/* Left-edge drag handle — horizontal panel resize, persisted to localStorage. */}
      <div
        onMouseDown={startPanelResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        title="Drag to resize the panel"
        data-testid="ai-panel-resize-handle"
        className="absolute left-0 top-0 bottom-0 w-1 -ml-0.5 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors z-50"
      />
      {/* Header — IDE style */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-base-300 bg-base-200/80 gap-2">
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <span className="text-primary font-bold text-xs tracking-wide hidden sm:inline">AI</span>
          {/* #55 — chat mode selector. Designer (full toolset, default),
              Ask (read-only Q&A), Review (read-only quality review). */}
          <select
            data-testid="ai-mode-select"
            className="select select-xs select-ghost font-sans text-[10px] uppercase tracking-wide"
            value={mode}
            onChange={(e) => {
              const next = e.target.value as ChatMode;
              if (CHAT_MODES.includes(next)) setMode(next);
            }}
            disabled={isLoading}
            title={
              mode === 'designer' ? 'Designer — full toolset, can create / modify' :
              mode === 'ask' ? 'Ask — read-only Q&A, no writes' :
              'Review — read-only quality review, no writes'
            }
          >
            <option value="designer">Designer</option>
            <option value="ask">Ask</option>
            <option value="review">Review</option>
          </select>
          {/* #64 — background autonomous mode toggle. When active, every
              tool category except delete auto-approves and the assistant
              bubble grows a Review / Undo all footer when the run lands. */}
          <button
            type="button"
            data-testid="ai-autonomous-toggle"
            data-active={autonomous ? 'true' : 'false'}
            className={`btn btn-xs btn-ghost font-sans text-[10px] uppercase tracking-wide ${autonomous ? 'text-warning' : 'text-base-content/50'}`}
            onClick={toggleAutonomous}
            title={autonomous
              ? 'Autonomous: ON — agent will run end-to-end without per-step approval (delete still pauses)'
              : 'Autonomous: OFF — per-category review policy applies'}
          >
            {autonomous ? '● auto' : '○ auto'}
          </button>
          {isLoading && <span className="loading loading-dots loading-xs text-primary"></span>}
          {/* Cost / token meter (#128). Hidden until at least one turn
              has reported usage. The cost half is only rendered when
              the backend has per-model pricing configured. */}
          {usage && (usage.inputTokens > 0 || usage.outputTokens > 0) && (
            <span
              data-testid="ai-usage-meter"
              className="badge badge-xs badge-ghost font-sans font-normal text-[10px] gap-1"
              title={`Tokens used this conversation: ${usage.inputTokens} in / ${usage.outputTokens} out${usage.cost !== undefined ? ` — estimated cost ${formatCost(usage.cost)}` : ' (configure ai.pricing in dico-app.json to see cost)'}`}
            >
              <span>~{formatTokens(usage.inputTokens)} in</span>
              <span className="text-base-content/40">/</span>
              <span>{formatTokens(usage.outputTokens)} out</span>
              {usage.cost !== undefined && (
                <>
                  <span className="text-base-content/40">·</span>
                  <span data-testid="ai-usage-cost">{formatCost(usage.cost)}</span>
                </>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button className={`btn btn-ghost btn-xs ${view === 'chat' ? 'btn-active' : ''}`} onClick={() => setView('chat')} title="Chat">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" clipRule="evenodd" />
            </svg>
          </button>
          <button className={`btn btn-ghost btn-xs ${view === 'history' ? 'btn-active' : ''}`} onClick={() => setView('history')} title="History">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
          </button>
          <button className={`btn btn-ghost btn-xs ${view === 'raw' ? 'btn-active' : ''}`} onClick={() => setView('raw')} title="Raw messages">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          <button className={`btn btn-ghost btn-xs ${view === 'tools' ? 'btn-active' : ''}`} onClick={() => setView('tools')} title="Tools">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
            </svg>
          </button>
          <button className={`btn btn-ghost btn-xs ${view === 'prompts' ? 'btn-active' : ''}`} onClick={() => setView('prompts')} title="Saved prompts">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
            </svg>
          </button>
          <div className="w-px h-4 bg-base-300 mx-1"></div>
          {/* Auto-approve is now per-category (#59). The Settings page
              owns the controls; the panel only shows where to find them. */}
          <a
            href="/settings#ai-auto-approve"
            className="btn btn-ghost btn-xs"
            title="Auto-approve policy (Settings)"
            data-testid="ai-policy-link"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          </a>
          {messages.length > 0 && (
            <div className="join rounded-md border border-base-content/20 bg-base-200">
              <button
                className="btn btn-ghost btn-xs join-item"
                onClick={() => exportCurrentConversation(false)}
                title="Download conversation (Markdown)"
                aria-label="Download conversation"
                data-testid="ai-export-current"
              >↓</button>
              <div className="dropdown dropdown-end join-item">
                <label tabIndex={0} className="btn btn-ghost btn-xs join-item px-1 border-l border-base-content/20" title="More download options" aria-label="More download options">▾</label>
                <ul tabIndex={0} className="dropdown-content menu z-50 mt-1 p-1 shadow-lg bg-base-100 rounded-box w-56 text-sm">
                  <li><button onClick={() => exportCurrentConversation(false)}>Download conversation</button></li>
                  <li><button onClick={() => exportCurrentConversation(true)} data-testid="ai-export-current-ctx">Download with system context</button></li>
                </ul>
              </div>
            </div>
          )}
          <button className="btn btn-ghost btn-xs" onClick={startNewConversation} title="New">+</button>
          <button className="btn btn-ghost btn-xs" onClick={onClose} title="Close">&times;</button>
        </div>
      </div>

      {/* Content area */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto relative">
        {/* === CHAT VIEW === */}
        {view === 'chat' && (
          <div className="p-3 space-y-3">
            {aiAvailable === false && (
              <div className="bg-warning/10 border border-warning/30 rounded px-3 py-2 text-xs">
                AI not configured. Go to <a href="/settings" className="link link-primary">Settings</a> to set up your provider.
              </div>
            )}

            {/* #127 — per-conversation system prompt override */}
            {systemPromptEditing ? (
              <div className="border border-base-300/40 rounded p-2 space-y-2 bg-base-200/30">
                <div className="text-[10px] font-bold uppercase tracking-wider text-base-content/50">System prompt (this conversation)</div>
                <textarea
                  className="textarea textarea-bordered textarea-xs w-full"
                  rows={4}
                  value={systemPromptOverride}
                  onChange={e => setSystemPromptOverride(e.target.value)}
                  placeholder="Leave empty to use the default."
                  data-testid="ai-system-prompt-editor"
                />
                <div className="flex gap-1">
                  <button
                    className="btn btn-xs btn-primary"
                    onClick={async () => {
                      await patchConversationFields(conversationId, { systemPrompt: systemPromptOverride });
                      setSystemPromptEditing(false);
                    }}
                  >Save</button>
                  <button className="btn btn-xs btn-ghost" onClick={() => setSystemPromptEditing(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <button
                className="btn btn-xs btn-ghost text-base-content/50 hover:text-base-content/80 normal-case justify-start"
                onClick={() => setSystemPromptEditing(true)}
                data-testid="ai-system-prompt-toggle"
                title="Override the system prompt for this conversation only"
              >
                {systemPromptOverride.trim() ? 'System prompt: customized' : '+ Custom system prompt'}
              </button>
            )}

            {messages.length === 0 && aiAvailable && (
              <div className="text-center text-base-content/40 mt-10 space-y-4">
                <div className="text-2xl">&#x2728;</div>
                <p className="text-xs font-sans">What would you like to build?</p>
                <div className="space-y-1.5">
                  {[
                    'Create an e-commerce data model',
                    'Add a Product entity with common attributes',
                    'Show me all entities',
                    'What stereotypes are available?',
                  ].map(s => (
                    <button key={s} className="btn btn-xs btn-ghost btn-block justify-start font-sans font-normal text-left text-base-content/60 hover:text-base-content" onClick={() => sendToAI(s)} disabled={isLoading}>
                      <span className="text-primary mr-1">&gt;</span> {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`group ${msg.role === 'user' ? 'pl-8' : 'pr-4'}`}>
                {/* #63 — pill rendered above the assistant bubble when the
                    backend folded older history into a summary before this
                    turn. Hover for the rough token count behind the
                    decision so power users can spot threshold issues. */}
                {msg.condensed && msg.role === 'assistant' && (
                  <div
                    data-testid="context-condensed-pill"
                    className="text-[10px] font-sans text-base-content/50 mb-1 italic"
                    title={msg.condensed.estimatedTokens
                      ? `~${msg.condensed.estimatedTokens.toLocaleString()} tokens estimated before condensing`
                      : 'Earlier conversation history was summarized'}
                  >
                    📦 Context condensed — {msg.condensed.count} earlier message{msg.condensed.count === 1 ? '' : 's'} summarized
                  </div>
                )}
                {/* Role label */}
                <div className="flex items-center gap-1 mb-0.5">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${msg.role === 'user' ? 'text-primary' : 'text-success'}`}>
                    {msg.role === 'user' ? 'You' : 'Assistant'}
                  </span>
                  {msg.cancelled && (
                    <span data-testid="message-cancelled-badge" className="badge badge-xs badge-ghost font-sans" title="User cancelled this response">
                      cancelled
                    </span>
                  )}
                  {msg.rawEvents && (
                    <button
                      className="opacity-0 group-hover:opacity-60 text-[10px] hover:opacity-100"
                      onClick={() => { setSelectedMsgId(msg.id); setView('raw'); }}
                      title="View raw"
                    >
                      &lt;/&gt;
                    </button>
                  )}
                </div>

                {/* Assistant tool calls — rendered BEFORE the prose bubble so chronological order reads top-to-bottom (#228). */}
                {msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0 && (() => {
                  const total = msg.toolCalls.length;
                  // "completed" = anything past the running/starting phase.
                  // Cancelled cards are terminal and count as complete so the
                  // progress counter can settle. (#61)
                  const completed = msg.toolCalls.filter(tc => tc.status !== 'starting' && tc.status !== 'running').length;
                  const showProgress = total > 1 && completed < total;
                  return (
                  <div className="mb-1.5 space-y-1">
                    {showProgress && (
                      <div data-testid="tool-progress" className="text-[10px] uppercase tracking-wider text-base-content/50 px-1">
                        {completed} of {total}
                      </div>
                    )}
                    {msg.toolCalls.map(tc => {
                      const isRunning = tc.status === 'starting' || tc.status === 'running';
                      const isCancelled = tc.status === 'cancelled';
                      const isError = !isRunning && !isCancelled && tc.output && tc.output.success === false;
                      const cleanName = tc.name.replace('functions.', '').split(':')[0];
                      // #178 slice 3 — MCP-sourced tools render a "from <label>"
                      // pill so the user can tell at a glance that an external
                      // server is doing the work (not a built-in). The name is
                      // namespaced `<connectionId>.<rawName>` so a dot in
                      // `cleanName` is the cheap pre-filter — but only the
                      // metadata `source === 'mcp'` actually trips the badge,
                      // so built-ins that happen to have dotted names (none
                      // today, but cheap to be safe) won't false-positive.
                      const def = toolDefByName.get(cleanName);
                      const isMcp = def?.source === 'mcp';
                      const mcpLabel = isMcp ? (def?.connectionLabel || def?.connectionId || '') : '';
                      // Compact JSON preview of the args, truncated for the
                      // collapsed header.
                      const inputPreview = tc.input
                        ? JSON.stringify(tc.input).slice(0, 80) + (JSON.stringify(tc.input).length > 80 ? '…' : '')
                        : '';
                      return (
                      <div
                        key={tc.id}
                        data-testid="tool-card"
                        data-status={tc.status || (isError ? 'error' : 'ok')}
                        className={`border rounded text-xs ${
                          tc.status === 'undone' ? 'border-error/30 bg-error/5 opacity-60' :
                          tc.status === 'pending' ? 'border-warning/50 bg-warning/5' :
                          isCancelled ? 'border-base-300/40 bg-base-200/30 opacity-70' :
                          isError ? 'border-error/60 bg-error/5' :
                          isRunning ? 'border-info/40 bg-info/5' :
                          'border-base-300/50 bg-base-200/30'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 px-2 py-1">
                          <button className="flex items-center gap-1.5 flex-1 text-left hover:bg-base-200/60" onClick={() => toggleTool(tc.id)}>
                            <span className={`text-[10px] inline-flex items-center justify-center w-3 ${
                              tc.status === 'undone' ? 'text-error' :
                              tc.status === 'pending' ? 'text-warning' :
                              isCancelled ? 'text-base-content/40' :
                              isError ? 'text-error' :
                              isRunning ? 'text-info' :
                              'text-success'
                            }`}>
                              {tc.status === 'undone' ? '↩' :
                               tc.status === 'pending' ? '⏳' :
                               isCancelled ? '⊘' :
                               isError ? '✗' :
                               isRunning ? <span className="loading loading-spinner loading-xs"></span> :
                               '✓'}
                            </span>
                            <span className="font-mono text-primary/80">
                              {isRunning ? `Calling ${cleanName}…` : cleanName}
                            </span>
                            {isMcp && mcpLabel && (
                              <span
                                data-testid="tool-source-badge"
                                data-source="mcp"
                                data-connection-label={mcpLabel}
                                className="badge badge-xs badge-info badge-outline font-sans"
                                title={`Tool source: ${mcpLabel} (MCP)`}
                              >
                                from {mcpLabel}
                              </span>
                            )}
                            {/* Per-category indicator (#59) — shows the
                                user *why* a card is pending vs auto-approved.
                                Pending cards get a warning-tinted pill so
                                the reason ("create — review") is obvious; ok
                                cards get a muted pill for orientation. */}
                            {tc.category && (
                              <span
                                data-testid="tool-category-badge"
                                data-category={tc.category}
                                className={`badge badge-xs font-sans uppercase tracking-wider ${
                                  tc.status === 'pending'
                                    ? 'badge-warning badge-outline'
                                    : 'badge-ghost'
                                }`}
                                title={`Category: ${tc.category}`}
                              >
                                {tc.category}
                              </span>
                            )}
                            {isError && (
                              <span data-testid="tool-error-badge" className="badge badge-xs badge-error font-sans">error</span>
                            )}
                            {isCancelled && (
                              <span data-testid="tool-cancelled-badge" className="badge badge-xs badge-ghost font-sans">cancelled</span>
                            )}
                            <span className="text-base-content/50 truncate flex-1 font-sans">
                              {tc.status === 'undone' ? 'Undone' :
                               isCancelled ? 'Cancelled' :
                               isError ? '' :
                               isRunning && tc.input ? inputPreview :
                               (typeof tc.output === 'string'
                                 ? tc.output.split('\n')[0].replace(/^#+\s*/, '').slice(0, 120)
                                 : tc.output?.summary || tc.output?.message || '')}
                            </span>
                            <span className="text-base-content/30">{expandedTools.has(tc.id) ? '▼' : '▶'}</span>
                          </button>
                          {tc.status === 'pending' && (
                            <>
                              {/* Approve unblocks the gated backend executor;
                                  Reject denies it so the tool never runs. The
                                  POST is what matters — see resolveGatedTool. */}
                              <button className="btn btn-xs btn-success btn-ghost" onClick={() => approveToolCall(msg.id, tc.id)} title="Approve this action">
                                ✓
                              </button>
                              <button className="btn btn-xs btn-error btn-ghost" onClick={() => rejectToolCall(msg.id, tc.id)} title="Reject this action">
                                ✗
                              </button>
                            </>
                          )}
                        </div>

                        {/* Inline error message for failed tool calls — visible
                            even when the card is collapsed. (#61 comment B) */}
                        {isError && (() => {
                          // #57 — diff preview path: createEntity on an existing entity.
                          // Detect from the tool name + the error string and surface a
                          // "Show diff" button that pulls the existing entity and
                          // renders a structured diff against the proposed JSON.
                          const isCreateEntityCollision = tc.name === 'createEntity'
                            && typeof tc.output?.error === 'string'
                            && /already exists/i.test(tc.output.error);
                          let proposed: any = null;
                          let pkgName: string | null = null;
                          let entityName: string | null = null;
                          if (isCreateEntityCollision) {
                            try {
                              const raw = (tc.input?.entityJson as string) || '';
                              proposed = raw ? JSON.parse(raw) : null;
                              pkgName = proposed?.packageName || null;
                              entityName = proposed?.name || null;
                            } catch {
                              proposed = null;
                            }
                          }
                          const diffState = entityDiffs[tc.id];
                          return (
                            <div className="px-2 pb-2 -mt-0.5">
                              <div className="bg-error/10 border border-error/30 rounded px-2 py-1 text-[11px] text-error font-sans">
                                {tc.output.error || 'Tool failed'}
                              </div>
                              <div className="flex gap-3 mt-1">
                                <button
                                  className="text-[10px] text-base-content/50 hover:text-base-content underline"
                                  onClick={() => toggleRaw(tc.id)}
                                >
                                  {rawShownTools.has(tc.id) ? 'Hide raw' : 'Show raw'}
                                </button>
                                {isCreateEntityCollision && proposed && pkgName && entityName && (
                                  <button
                                    className="text-[10px] text-primary hover:underline"
                                    data-testid={`ai-show-diff-${tc.id}`}
                                    onClick={() => {
                                      if (diffState && diffState !== 'loading' && diffState !== 'error') {
                                        // Toggle off — clear so the next click reloads.
                                        setEntityDiffs(prev => { const n = { ...prev }; delete n[tc.id]; return n; });
                                      } else {
                                        loadEntityDiff(tc.id, pkgName!, entityName!, proposed);
                                      }
                                    }}
                                  >
                                    {(diffState && diffState !== 'loading' && diffState !== 'error') ? 'Hide diff' : 'Show diff'}
                                  </button>
                                )}
                              </div>
                              {rawShownTools.has(tc.id) && (
                                <pre className="mt-1 bg-base-300/30 rounded p-1.5 overflow-x-auto text-[11px]">{JSON.stringify(tc.output, null, 2)}</pre>
                              )}
                              {diffState === 'loading' && (
                                <div className="mt-1 text-[10px] text-base-content/40 italic">Loading diff…</div>
                              )}
                              {diffState === 'error' && (
                                <div className="mt-1 text-[10px] text-error">Could not load existing entity.</div>
                              )}
                              {diffState && diffState !== 'loading' && diffState !== 'error' && (
                                <EntityDiff existing={diffState.existing} proposed={diffState.proposed} />
                              )}
                            </div>
                          );
                        })()}

                        {expandedTools.has(tc.id) && (
                          <div className="px-2 pb-2 space-y-1">
                            {tc.input && (
                              <div>
                                <div className="text-[10px] text-base-content/40 uppercase mb-0.5">Input</div>
                                <pre className="bg-base-300/30 rounded p-1.5 overflow-x-auto text-[11px]">{JSON.stringify(tc.input, null, 2)}</pre>
                              </div>
                            )}
                            {!isError && tc.output !== null && (
                              <div>
                                <div className="text-[10px] text-base-content/40 uppercase mb-0.5">Output</div>
                                {/* #191 — structured mutation results render a
                                    summary card; everything else keeps the
                                    raw-JSON fallback. */}
                                {tc.output?.changeKind && tc.output?.elementType ? (
                                  <ChangeSummaryCard output={tc.output} />
                                ) : (
                                  <pre className="bg-base-300/30 rounded p-1.5 overflow-x-auto text-[11px] whitespace-pre-wrap">{typeof tc.output === 'string' ? tc.output : JSON.stringify(tc.output, null, 2)}</pre>
                                )}
                              </div>
                            )}
                            {isRunning && tc.output === null && (
                              <div className="text-[10px] text-base-content/40 italic">Awaiting result…</div>
                            )}
                          </div>
                        )}
                      </div>
                      );
                    })}

                    {/* Approve all / Reject all bar. Approve All unblocks
                        every gated executor; Reject All denies them so they
                        never run (POST 'deny' — not a post-hoc DELETE). */}
                    {msg.toolCalls.some(tc => tc.status === 'pending') && (
                      <div className="flex items-center gap-2 mt-2 p-2 bg-warning/10 border border-warning/30 rounded">
                        <span className="text-[10px] font-bold text-warning uppercase flex-1">Review required</span>
                        <button className="btn btn-xs btn-success" onClick={() => approveAllTools(msg.id)}>Approve All</button>
                        <button className="btn btn-xs btn-error btn-outline" onClick={() => {
                          msg.toolCalls?.filter(tc => tc.status === 'pending').forEach(tc => rejectToolCall(msg.id, tc.id));
                        }}>Reject All</button>
                      </div>
                    )}
                    {/* #64 — autonomous-run summary footer. Only shows
                        once the stream is no longer in flight (no tools
                        in 'starting' or 'running' state) AND the turn
                        was started in autonomous mode. */}
                    {msg.autonomous && (() => {
                      const stillRunning = msg.toolCalls?.some(tc => tc.status === 'starting' || tc.status === 'running');
                      const undoable = (msg.toolCalls || []).filter(tc =>
                        tc.status !== 'undone' &&
                        tc.status !== 'cancelled' &&
                        tc.output?.success !== false &&
                        typeof tc.output?.navigate === 'string' &&
                        /\/packages\/[^/]+\/entities\/[^/]+/.test(tc.output.navigate));
                      if (stillRunning) {
                        return (
                          <div
                            data-testid="autonomous-progress"
                            className="flex items-center gap-2 mt-2 p-2 bg-info/10 border border-info/30 rounded text-[10px] font-sans"
                          >
                            <span className="loading loading-spinner loading-xs"></span>
                            <span className="flex-1">Autonomous run — {msg.toolCalls?.length || 0} step{(msg.toolCalls?.length || 0) === 1 ? '' : 's'} so far</span>
                          </div>
                        );
                      }
                      return (
                        <div
                          data-testid="autonomous-summary"
                          className="flex items-center gap-2 mt-2 p-2 bg-success/10 border border-success/30 rounded text-[10px] font-sans"
                        >
                          <span className="flex-1">
                            ✓ Autonomous run complete — {msg.toolCalls?.length || 0} tool{(msg.toolCalls?.length || 0) === 1 ? '' : 's'} executed
                          </span>
                          <button
                            type="button"
                            data-testid="autonomous-review-btn"
                            className="btn btn-xs btn-ghost"
                            onClick={() => setExpandedTools(prev => {
                              const next = new Set(prev);
                              msg.toolCalls?.forEach(tc => next.add(tc.id));
                              return next;
                            })}
                            title="Expand every tool card so you can audit the run"
                          >
                            Review
                          </button>
                          {undoable.length > 0 && (
                            <button
                              type="button"
                              data-testid="autonomous-undo-all-btn"
                              className="btn btn-xs btn-error btn-outline"
                              onClick={() => undoable.forEach(tc => undoToolCall(msg.id, tc.id))}
                              title={`Roll back ${undoable.length} action${undoable.length === 1 ? '' : 's'} (deletes created entities)`}
                            >
                              Undo all
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  );
                })()}

                {/* Message content */}
                <div className={`rounded-lg px-3 py-2 text-sm font-sans ${
                  msg.role === 'user'
                    ? 'bg-primary/10 border border-primary/20'
                    : 'bg-base-200/50 border border-base-300/50'
                }`}>
                  {msg.role === 'user' ? (
                    editingMsgId === msg.id ? (
                      <div className="space-y-2" data-testid="edit-user-msg">
                        <textarea
                          className="textarea textarea-bordered w-full text-sm font-sans"
                          rows={Math.max(2, Math.min(6, editDraft.split('\n').length))}
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              saveEditAndResend();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelEdit();
                            }
                          }}
                          autoFocus
                        />
                        <div className="flex gap-1 justify-end">
                          <button
                            type="button"
                            className="btn btn-xs btn-ghost"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn-xs btn-primary"
                            data-testid="edit-save-button"
                            onClick={saveEditAndResend}
                            disabled={!editDraft.trim() || isLoading}
                          >
                            Save &amp; resend
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-left w-full hover:opacity-80 cursor-text"
                        title="Click to edit and resend"
                        data-testid="user-msg-text"
                        onClick={() => beginEdit(msg.id)}
                      >
                        {msg.text}
                      </button>
                    )
                  ) : (
                    <div className="prose prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0 [&_pre]:my-1 [&_code]:text-xs [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm">
                      <Markdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({ inline, className, children, ...rest }: any) {
                            const lang = /language-(\w+)/.exec(className || '')?.[1];
                            if (inline || !lang) {
                              return <code className={className} {...rest}>{children}</code>;
                            }
                            const code = String(children).replace(/\n$/, '');
                            // Render ```mermaid blocks as diagrams instead of code.
                            if (lang === 'mermaid') {
                              return <MermaidDiagram code={code} isDark={isDark} />;
                            }
                            const isCopied = copiedKey === code;
                            const isCopyFailed = copyFailedKey === code;
                            const isSql = lang === 'sql';
                            return (
                              <div className="relative group/code">
                                <div className="absolute right-1 top-1 flex gap-1 z-10">
                                  {isSql && (
                                    <button
                                      type="button"
                                      className="btn btn-xs btn-primary opacity-90 hover:opacity-100"
                                      onClick={() => runSqlBlock(code)}
                                      title="Run this query against the package database"
                                      data-testid="run-sql-button"
                                    >
                                      ▶ Run
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={`btn btn-xs btn-ghost transition-opacity ${
                                      isCopied || isCopyFailed
                                        ? 'opacity-100'
                                        : 'opacity-0 group-hover/code:opacity-100'
                                    }`}
                                    onClick={() => handleCopy(code)}
                                    title={isCopyFailed ? 'Copy failed (clipboard unavailable)' : 'Copy'}
                                    data-testid="copy-code-button"
                                  >
                                    {isCopied ? 'Copied!' : isCopyFailed ? 'Copy failed' : 'Copy'}
                                  </button>
                                </div>
                                <SyntaxHighlighter
                                  language={lang}
                                  style={isDark ? oneDark : oneLight}
                                  PreTag="div"
                                  customStyle={{ margin: 0, fontSize: '11px', borderRadius: '4px' }}
                                >
                                  {code}
                                </SyntaxHighlighter>
                              </div>
                            );
                          },
                          // #60 — linkify @EntityName tokens inside text-bearing
                          // elements. Skips code blocks (handled above) so a
                          // literal `@Foo` in a fenced block stays literal.
                          p: ({ children, ...rest }: any) => <p {...rest}>{processMentions(children)}</p>,
                          li: ({ children, ...rest }: any) => <li {...rest}>{processMentions(children)}</li>,
                          // GFM tables: bordered cells, a strong header band, and
                          // zebra rows — all theme tokens so it reads in both light
                          // and dark. `prose` alone leaves tables borderless.
                          table: ({ children, ...rest }: any) => (
                            <table {...rest} className="my-2 w-full border-collapse border border-base-content/30 text-xs">{children}</table>
                          ),
                          thead: ({ children, ...rest }: any) => (
                            <thead {...rest} className="bg-primary/15 text-base-content">{children}</thead>
                          ),
                          tr: ({ children, ...rest }: any) => (
                            <tr {...rest} className="even:bg-base-content/5">{children}</tr>
                          ),
                          td: ({ children, ...rest }: any) => (
                            <td {...rest} className="border border-base-content/30 px-2 py-1 align-top">{processMentions(children)}</td>
                          ),
                          th: ({ children, ...rest }: any) => (
                            <th {...rest} className="border border-base-content/30 px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wide">{processMentions(children)}</th>
                          ),
                          h1: ({ children, ...rest }: any) => <h1 {...rest}>{processMentions(children)}</h1>,
                          h2: ({ children, ...rest }: any) => <h2 {...rest}>{processMentions(children)}</h2>,
                          h3: ({ children, ...rest }: any) => <h3 {...rest}>{processMentions(children)}</h3>,
                          strong: ({ children, ...rest }: any) => <strong {...rest}>{processMentions(children)}</strong>,
                          em: ({ children, ...rest }: any) => <em {...rest}>{processMentions(children)}</em>,
                        }}
                      >{msg.text}</Markdown>
                    </div>
                  )}
                </div>

                {/* #192 — visible, non-error notice that the agentic loop
                    stopped because it hit its step budget. NOT the red error
                    banner (this isn't an error). Mirrors the condensed pill's
                    muted-italic styling. The model's summary of what it did /
                    what remains was streamed as normal text above. */}
                {msg.stepLimit && msg.role === 'assistant' && (
                  <div
                    data-testid="step-limit-pill"
                    className="text-[10px] font-sans text-base-content/50 mt-1 italic"
                    title="The assistant ran out of tool-call steps for this turn; it summarized progress above."
                  >
                    ⏹ Stopped after the {msg.stepLimit.limit}-step limit — summarized above
                  </div>
                )}
                {/* #confab-guard — visible warning when the model claimed a
                    change but no mutating tool actually succeeded this turn. */}
                {msg.noOpWarning && msg.role === 'assistant' && (
                  <div
                    data-testid="no-op-warning-pill"
                    className="text-[11px] font-sans text-warning mt-1 flex items-start gap-1"
                    title="No create/update/delete succeeded this turn — the change was not saved."
                  >
                    <span aria-hidden>⚠</span>
                    <span>{msg.noOpWarning}</span>
                  </div>
                )}
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="pr-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-success">Assistant</span>
                <div className="bg-base-200/50 border border-base-300/50 rounded-lg px-3 py-2 mt-0.5">
                  <span className="loading loading-dots loading-xs"></span>
                </div>
              </div>
            )}

            {error && (
              <div
                data-testid="ai-error-banner"
                className="bg-error/10 border border-error/30 rounded px-3 py-2 text-xs text-error font-sans space-y-1"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-bold flex items-center gap-2">
                      <span>AI request failed</span>
                      {errorDetails?.upstreamStatus !== undefined && (
                        <span className="badge badge-xs badge-error">
                          {errorDetails.upstreamStatus}
                          {errorDetails.providerCode !== undefined && errorDetails.providerCode !== errorDetails.upstreamStatus
                            ? ` · ${errorDetails.providerCode}` : ''}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-error/90 whitespace-pre-wrap break-words">{error}</div>
                    {errorDetails?.providerHelpUrl && (
                      <a
                        href={errorDetails.providerHelpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link link-error mt-1 inline-block"
                        data-testid="ai-error-help-link"
                      >
                        Open help link →
                      </a>
                    )}
                    {errorDetails?.upstreamStatus === 402 && (
                      <div className="mt-1 text-base-content/60 italic">
                        Tip: top up your provider account, lower <code>max_tokens</code>, or switch to a free model in <a href="/settings#ai" className="link">Settings</a>.
                      </div>
                    )}
                    {errorDetails?.upstreamStatus === 401 && (
                      <div className="mt-1 text-base-content/60 italic">
                        Tip: your API key was rejected — check it in <a href="/settings#ai" className="link">Settings</a>.
                      </div>
                    )}
                    {errorDetails?.upstreamStatus === 429 && (
                      <div className="mt-1 text-base-content/60 italic">
                        Tip: rate-limited by the provider — wait a moment and retry, or switch model.
                      </div>
                    )}
                    {(errorDetails?.providerRaw || errorDetails?.diagnostics) && (
                      <details
                        className="mt-2 text-base-content/80"
                        data-testid="ai-error-technical-details"
                      >
                        <summary className="cursor-pointer select-none font-semibold">
                          Technical details
                        </summary>
                        <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-base-300/60 p-2 text-[10px] text-base-content">
                          {JSON.stringify({
                            status: errorDetails.upstreamStatus,
                            providerCode: errorDetails.providerCode,
                            providerMessage: errorDetails.providerMessage,
                            providerRaw: errorDetails.providerRaw,
                            diagnostics: errorDetails.diagnostics,
                          }, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-xs btn-error btn-outline shrink-0"
                    data-testid="ai-retry-button"
                    onClick={retryLast}
                    disabled={isLoading}
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}

            {/* Always-available retry trigger when there's a prior user
                message and we're idle. Hidden behind error to keep the
                UI quiet during streaming. (#126) */}
            {!error && !isLoading && messages.some(m => m.role === 'user') && (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn btn-xs btn-ghost text-base-content/40 hover:text-base-content"
                  data-testid="ai-retry-button-idle"
                  onClick={retryLast}
                  title="Retry last message"
                >
                  ↻ Retry last
                </button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}

        {/* "↓ New messages" pill when scroll is locked and deltas
            arrive while the user is reading earlier content. (#126) */}
        {view === 'chat' && scrollLocked && hasUnseenDeltas && (
          <button
            type="button"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 btn btn-xs btn-primary shadow-lg z-10"
            data-testid="ai-new-messages-pill"
            onClick={jumpToBottom}
          >
            ↓ New messages
          </button>
        )}

        {/* === HISTORY VIEW === */}
        {view === 'history' && (
          <div className="p-3 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-base-content/50">Conversations</div>
            <input
              type="search"
              placeholder="Search conversations…"
              value={conversationQuery}
              onChange={e => setConversationQuery(e.target.value)}
              data-testid="ai-conversation-search"
              className="input input-bordered input-xs w-full"
            />
            {conversationList.length === 0 ? (
              <div className="text-xs text-base-content/30 text-center mt-8">
                {conversationQuery ? 'No matches' : 'No saved conversations'}
              </div>
            ) : conversationList.map(conv => (
              <div key={conv.id} className="flex items-center gap-1 group">
                <button
                  className={`btn btn-xs btn-ghost px-1 ${conv.pinned ? 'text-warning' : 'opacity-50 hover:opacity-100'}`}
                  title={conv.pinned ? 'Unpin' : 'Pin'}
                  data-testid={`ai-pin-${conv.id}`}
                  onClick={() => patchConversationFields(conv.id, { pinned: !conv.pinned })}
                >★</button>
                {renamingConvId === conv.id ? (
                  <input
                    autoFocus
                    className="input input-xs input-bordered flex-1"
                    value={renameDraft}
                    onChange={e => setRenameDraft(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter') {
                        const t = renameDraft.trim();
                        if (t) await patchConversationFields(conv.id, { title: t });
                        setRenamingConvId(null);
                      } else if (e.key === 'Escape') {
                        setRenamingConvId(null);
                      }
                    }}
                    onBlur={() => setRenamingConvId(null)}
                    data-testid="ai-rename-input"
                  />
                ) : (
                  <button
                    className={`btn btn-xs btn-block justify-start text-left font-sans font-normal flex-1 ${conv.id === conversationId ? 'btn-primary btn-outline' : 'btn-ghost'}`}
                    onClick={() => loadConversation(conv.id)}
                    onDoubleClick={() => { setRenamingConvId(conv.id); setRenameDraft(conv.title); }}
                    title="Double-click to rename"
                  >
                    <span className="truncate flex-1">{conv.title}</span>
                    <span className="badge badge-xs badge-ghost">{conv.messageCount}</span>
                  </button>
                )}
                <div className="join rounded-md border border-base-content/20 bg-base-200 opacity-0 group-hover:opacity-100">
                  <button
                    className="btn btn-xs btn-ghost join-item"
                    title="Download conversation (Markdown)"
                    aria-label={`Download ${conv.title}`}
                    data-testid={`ai-export-${conv.id}`}
                    onClick={() => exportConversation(conv.id, false)}
                  >↓</button>
                  <div className="dropdown dropdown-end join-item">
                    <label tabIndex={0} className="btn btn-xs btn-ghost join-item px-1 border-l border-base-content/20" title="More download options" aria-label="More download options">▾</label>
                    <ul tabIndex={0} className="dropdown-content menu z-50 mt-1 p-1 shadow-lg bg-base-100 rounded-box w-56 text-sm">
                      <li><button onClick={() => exportConversation(conv.id, false)}>Download conversation</button></li>
                      <li><button onClick={() => exportConversation(conv.id, true)} data-testid={`ai-export-ctx-${conv.id}`}>Download with system context</button></li>
                    </ul>
                  </div>
                </div>
                <button className="btn btn-xs btn-ghost text-error opacity-0 group-hover:opacity-100" onClick={() => deleteConversation(conv.id)}>&times;</button>
              </div>
            ))}
          </div>
        )}

        {/* === RAW VIEW === */}
        {view === 'raw' && (
          <div className="p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-base-content/50 mb-2">
              Raw API Exchange {selectedMsgId && <button className="btn btn-xs btn-ghost ml-2" onClick={() => setSelectedMsgId(null)}>Show all</button>}
            </div>

            {/* Message selector tabs */}
            {!selectedMsgId && (
              <div className="space-y-1 mb-3">
                {messages.filter(m => m.rawEvents?.length).map(msg => (
                  <button
                    key={msg.id}
                    className="btn btn-xs btn-ghost btn-block justify-start font-normal text-left"
                    onClick={() => setSelectedMsgId(msg.id)}
                  >
                    <span className={`text-[10px] ${msg.role === 'user' ? 'text-primary' : 'text-success'}`}>{msg.role}</span>
                    <span className="truncate flex-1 text-base-content/60">{msg.text?.slice(0, 50)}</span>
                    <span className="badge badge-xs badge-ghost">{msg.rawEvents?.length || 0} events</span>
                  </button>
                ))}
                {messages.filter(m => m.rawEvents?.length).length === 0 && (
                  <div className="text-xs text-base-content/30 text-center mt-8">No raw data yet. Send a message first.</div>
                )}
              </div>
            )}

            {/* Raw events */}
            {selectedRaw && (
              <div className="space-y-1">
                {selectedRaw.map((evt, i) => (
                  <div key={i} className="border border-base-300/40 rounded bg-base-200/20">
                    <div className="flex items-center px-2 py-0.5 text-[10px]">
                      <span className={`font-bold mr-2 ${
                        evt.type?.includes('text') ? 'text-info' :
                        evt.type?.includes('tool') ? 'text-warning' :
                        evt.type?.includes('error') ? 'text-error' :
                        'text-base-content/40'
                      }`}>{evt.type}</span>
                      {evt.toolName && <span className="text-base-content/40">{evt.toolName}</span>}
                      {evt.delta && <span className="text-base-content/60 truncate ml-auto">{evt.delta}</span>}
                    </div>
                    {(evt.input || evt.output || evt.errorText) && (
                      <pre className="px-2 pb-1 text-[10px] text-base-content/50 overflow-x-auto max-h-32 overflow-y-auto">
                        {JSON.stringify(evt.input || evt.output || evt.errorText, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* === TOOLS VIEW === */}
        {view === 'tools' && (
          <div className="p-3 space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-base-content/50 mb-2">
              Available Tools ({toolDefs.length})
            </div>
            {toolDefs.map(tool => (
              <div key={tool.name} className="border border-base-300/50 rounded bg-base-200/20">
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-primary font-bold text-xs">{tool.name}</span>
                    {tool.source === 'mcp' && (
                      <span
                        data-testid="tools-view-source-badge"
                        data-connection-label={tool.connectionLabel || tool.connectionId || ''}
                        className="badge badge-xs badge-info badge-outline font-sans"
                        title={`Source: ${tool.connectionLabel || tool.connectionId} (MCP)`}
                      >
                        from {tool.connectionLabel || tool.connectionId}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-base-content/60 font-sans">{tool.description}</p>
                </div>
                {tool.parameters.length > 0 && (
                  <div className="border-t border-base-300/30 px-3 py-2">
                    <div className="text-[10px] uppercase text-base-content/40 mb-1">Parameters</div>
                    <div className="space-y-1">
                      {tool.parameters.map(p => (
                        <div key={p.name} className="flex items-start gap-2 text-xs">
                          <code className="text-primary/80 shrink-0">{p.name}</code>
                          <span className="badge badge-xs badge-ghost shrink-0">{p.type}</span>
                          {p.required && <span className="badge badge-xs badge-warning shrink-0">req</span>}
                          <span className="text-base-content/50 font-sans text-[11px]">{p.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* === PROMPTS VIEW (#123) === */}
        {view === 'prompts' && (
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-wider text-base-content/50">
                Saved Prompts ({prompts.length})
              </div>
              {editingPromptId === null && promptNameDraft === '' && promptContentDraft === '' && (
                <button
                  className="btn btn-xs btn-primary"
                  onClick={() => startNewPromptDraft('')}
                  title="Create a new prompt"
                >
                  + New
                </button>
              )}
            </div>

            {/* Editor — shown when creating or editing */}
            {(editingPromptId !== null || promptNameDraft !== '' || promptContentDraft !== '') && (
              <div className="border border-primary/30 rounded bg-primary/5 p-2 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-primary">
                  {editingPromptId !== null ? 'Edit prompt' : 'New prompt'}
                </div>
                <input
                  type="text"
                  className="input input-xs input-bordered w-full font-sans"
                  placeholder="Name (e.g. Summarize entity)"
                  value={promptNameDraft}
                  onChange={(e) => setPromptNameDraft(e.target.value)}
                />
                <textarea
                  className="textarea textarea-xs textarea-bordered w-full font-sans text-xs"
                  rows={5}
                  placeholder="Prompt content"
                  value={promptContentDraft}
                  onChange={(e) => setPromptContentDraft(e.target.value)}
                />
                {promptError && (
                  <div className="text-[11px] text-error">{promptError}</div>
                )}
                <div className="flex items-center gap-2 justify-end">
                  <button className="btn btn-xs btn-ghost" onClick={cancelPromptDraft}>Cancel</button>
                  <button className="btn btn-xs btn-primary" onClick={savePromptDraft}>
                    {editingPromptId !== null ? 'Save' : 'Create'}
                  </button>
                </div>
              </div>
            )}

            {/* List */}
            {prompts.length === 0 && editingPromptId === null && (
              <div className="text-xs text-base-content/30 text-center mt-8 font-sans">
                No saved prompts yet. Click <strong>+ New</strong> to create one,
                or use <em>Save as prompt</em> below the composer.
              </div>
            )}

            {prompts.map(p => (
              <div key={p.id} className="border border-base-300/50 rounded bg-base-200/20">
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-primary font-bold text-xs truncate flex-1">{p.name}</span>
                    <button
                      className="btn btn-xs btn-ghost"
                      onClick={() => insertPromptIntoComposer(p)}
                      title="Insert into composer"
                    >
                      Insert
                    </button>
                    <button
                      className="btn btn-xs btn-ghost"
                      onClick={() => startEditPrompt(p)}
                      title="Edit"
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-xs btn-ghost text-error"
                      onClick={() => deletePrompt(p.id)}
                      title="Delete"
                    >
                      &times;
                    </button>
                  </div>
                  <p className="text-xs text-base-content/60 font-sans whitespace-pre-wrap line-clamp-3">{p.content}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Page-context pill — sits above the composer */}
      {view === 'chat' && (
        <div className="px-3 pt-2 pb-0 border-t border-base-300 bg-base-200/30">
          <button
            type="button"
            onClick={() => pageContext && toggleIncludePageContext(!includePageContext)}
            disabled={!pageContext}
            title={
              pageContext
                ? (includePageContext
                    ? `Page context will be sent to the AI: "${pageContext}"`
                    : 'Page context is currently disabled. Click to include it.')
                : 'No page context available for this route.'
            }
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-sans transition ${
              !pageContext
                ? 'border-base-300/50 bg-base-200/40 text-base-content/30 cursor-not-allowed'
                : includePageContext
                  ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                  : 'border-base-300 bg-base-100 text-base-content/50 hover:bg-base-200'
            }`}
          >
            <span aria-hidden>📍</span>
            <span>
              {pageContext
                ? (includePageContext ? 'Including page context' : 'Page context off')
                : 'No page context'}
            </span>
          </button>
          {pageContext && includePageContext && (
            <div className="mt-1 text-[10px] text-base-content/50 truncate font-sans" title={pageContext}>
              {pageContext}
            </div>
          )}
        </div>
      )}

      {/* Input — IDE style */}
      <form onSubmit={handleSubmit} className="px-3 py-2 border-t border-base-300 bg-base-200/30 relative">
        {/* #56 slash command palette — anchored above the composer.
            Mutually exclusive with the mention picker (slash only fires
            at start of input, mention only after whitespace). */}
        {slashToken !== null && filterSlashCommands(slashToken).length > 0 && (
          <div
            data-testid="ai-slash-picker"
            className="absolute left-3 right-3 bottom-full mb-1 bg-base-100 border border-base-300 rounded shadow-md z-10 max-h-60 overflow-auto text-xs"
          >
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-base-content/40 bg-base-200/40">
              Commands
            </div>
            {filterSlashCommands(slashToken).map(cmd => (
              <button
                key={cmd.name}
                type="button"
                data-testid={`ai-slash-option-${cmd.name}`}
                className="block w-full text-left px-2 py-1 hover:bg-base-200 font-mono"
                onMouseDown={ev => { ev.preventDefault(); applySlashCommand(cmd); }}
              >
                /{cmd.name} <span className="text-base-content/40 font-sans">— {cmd.description}</span>
              </button>
            ))}
          </div>
        )}
        {/* #54 mention picker — anchored above the composer */}
        {mentionToken !== null && (mentionResults.entities.length + mentionResults.packages.length) > 0 && (
          <div
            data-testid="ai-mention-picker"
            className="absolute left-3 right-3 bottom-full mb-1 bg-base-100 border border-base-300 rounded shadow-md z-10 max-h-60 overflow-auto text-xs"
          >
            {mentionResults.entities.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-base-content/40 bg-base-200/40">Entities</div>
                {mentionResults.entities.map(e => (
                  <button
                    key={`e-${e.packageName}-${e.name}`}
                    type="button"
                    className="block w-full text-left px-2 py-1 hover:bg-base-200 font-mono"
                    onMouseDown={ev => { ev.preventDefault(); insertMention(e.name); }}
                  >
                    @{e.name} <span className="text-base-content/40 font-sans">in {e.packageName}</span>
                  </button>
                ))}
              </div>
            )}
            {mentionResults.packages.length > 0 && (
              <div>
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-base-content/40 bg-base-200/40">Packages</div>
                {mentionResults.packages.map(p => (
                  <button
                    key={`p-${p.name}`}
                    type="button"
                    className="block w-full text-left px-2 py-1 hover:bg-base-200 font-mono"
                    onMouseDown={ev => { ev.preventDefault(); insertMention(p.name); }}
                  >
                    @{p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {/*
         * Composer layout (#178 demo prep — visible resize handle):
         * Textarea spans the full width of the rounded box so its
         * native diagonal-stripe resize handle lands at the visible
         * bottom-right corner — exactly where the eye expects to
         * grab. The `>` prompt + Send/Stop button live on the row
         * BELOW the textarea, sharing the same wrapper border +
         * focus ring.
         */}
        <div
          className="flex flex-col border border-base-300 rounded-md bg-base-100 focus-within:border-primary/50 transition-colors"
          data-testid="ai-composer-wrapper"
        >
          <textarea
            ref={inputRef}
            rows={1}
            className="textarea textarea-ghost textarea-xs font-mono focus:outline-none bg-transparent resize-y min-h-[1.75rem] max-h-[60vh] w-full px-2 py-1"
            placeholder={aiAvailable ? "Ask about your data model... (⌘↵ send · ⇧↵ newline · @entity, @package)" : "AI not configured"}
            value={input}
            onChange={handleComposerChange}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && mentionToken !== null) {
                e.preventDefault();
                setMentionToken(null);
                setMentionResults({ entities: [], packages: [] });
                return;
              }
              // #56 — Escape also dismisses the slash command palette.
              if (e.key === 'Escape' && slashToken !== null) {
                e.preventDefault();
                setSlashToken(null);
                return;
              }
              handleComposerKeyDown(e);
            }}
            disabled={!aiAvailable || isLoading}
            data-testid="ai-composer-input"
            onMouseUp={persistComposerHeight}
            title="⌘↵ / Ctrl↵ send · ⇧↵ newline · ⌘K focus chat · @ to mention · drag bottom-right corner to resize"
          />
          <div className="flex items-center gap-1.5 px-2 py-1 border-t border-base-300/50">
            <span className="text-primary text-xs">&gt;</span>
            <span className="text-[10px] text-base-content/40 font-sans flex-1 truncate">
              ⌘↵ send · ⇧↵ newline · drag bottom-right to resize
            </span>
            {isLoading ? (
            <button
              type="button"
              className="btn btn-xs btn-error btn-square"
              onClick={stopStream}
              title="Stop"
              data-testid="ai-stop-button"
              aria-label="Stop"
            >
              {/* Square stop glyph */}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <rect x="5" y="5" width="10" height="10" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              className="btn btn-xs btn-primary btn-square"
              disabled={!aiAvailable || !input.trim()}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          )}
          </div>
        </div>
        {/* Save current input as prompt (#123) */}
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            className="text-[10px] text-base-content/50 hover:text-primary disabled:opacity-40 disabled:hover:text-base-content/50 font-sans"
            onClick={saveCurrentInputAsPrompt}
            disabled={!input.trim()}
            title="Save the current composer text as a reusable prompt"
          >
            Save as prompt…
          </button>
        </div>
      </form>
      {sqlToRun && (
        <SqlRunModal
          open={!!sqlToRun}
          sql={sqlToRun.sql}
          packageName={sqlToRun.packageName}
          onClose={() => setSqlToRun(null)}
        />
      )}
    </div>
  );
}

/**
 * #57 — render a structured diff between an existing entity and a proposed
 * one. Top-level fields (description, stereotype, status) plus per-attribute
 * adds / removals / modifications. We diff by attribute *name* — uuid drift
 * is intentionally ignored because the AI doesn't know existing uuids.
 */
/**
 * Structured change-summary card (#191 §A) — replaces the raw-JSON dump in
 * an applied mutation's expanded tool card. Renders a change-kind badge
 * (created = success, updated = info/neutral, deleted = warning/danger),
 * the elementType, the name, the package, and the canonical `summary`.
 *
 * Detected by the caller via `output.changeKind && output.elementType`;
 * non-structured outputs keep the JSON fallback.
 */
export function ChangeSummaryCard({ output }: { output: any }) {
  const kind: string = output.changeKind;
  const tone: 'success' | 'info' | 'danger' =
    kind === 'created' ? 'success' : kind === 'deleted' ? 'danger' : 'info';

  return (
    <div
      className="rounded-token-sm border border-base-300 bg-base-100 p-2 space-y-1"
      data-testid="ai-change-summary"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Chip tone={tone} soft>{kind}</Chip>
        <span className="text-[10px] uppercase tracking-wide text-base-content/50">
          {output.elementType}
        </span>
        <span className="font-mono text-[12px] text-base-content/90 truncate">
          {output.name}
        </span>
      </div>
      <div className="text-[11px] text-base-content/60">
        Package <span className="font-mono text-base-content/80">{output.packageName}</span>
      </div>
      {output.summary && (
        <div className="text-[11px] text-base-content/70">{output.summary}</div>
      )}
    </div>
  );
}

export function EntityDiff({ existing, proposed }: { existing: any; proposed: any }) {
  const fields: Array<{ key: string; label: string }> = [
    { key: 'description', label: 'description' },
    { key: 'stereotype', label: 'stereotype' },
    { key: 'status', label: 'status' },
  ];
  const fieldRows = fields.map(f => {
    const a = existing?.[f.key];
    const b = proposed?.[f.key];
    if ((a ?? '') === (b ?? '')) return null;
    return { label: f.label, a, b };
  }).filter(Boolean) as Array<{ label: string; a: any; b: any }>;

  const existingAttrs: any[] = Array.isArray(existing?.attributes) ? existing.attributes : [];
  const proposedAttrs: any[] = Array.isArray(proposed?.attributes) ? proposed.attributes : [];
  const byName = new Map<string, { a?: any; b?: any }>();
  for (const x of existingAttrs) if (x?.name) byName.set(x.name, { ...byName.get(x.name), a: x });
  for (const y of proposedAttrs) if (y?.name) byName.set(y.name, { ...byName.get(y.name), b: y });

  const added: any[] = [];
  const removed: any[] = [];
  const modified: Array<{ name: string; a: any; b: any }> = [];
  for (const [name, { a, b }] of byName) {
    if (!a && b) added.push(b);
    else if (a && !b) removed.push(a);
    else if (a && b) {
      // Compare type / required / description / primaryKey — fields the AI
      // can plausibly change. We don't compare validation here to keep the
      // diff readable; users can still expand the raw output.
      const sameish = a.type === b.type && !!a.required === !!b.required && (a.description || '') === (b.description || '') && !!a.primaryKey === !!b.primaryKey;
      if (!sameish) modified.push({ name, a, b });
    }
  }

  if (fieldRows.length === 0 && added.length === 0 && removed.length === 0 && modified.length === 0) {
    return <div className="mt-1 text-[10px] text-base-content/40">No diff — existing and proposed look identical.</div>;
  }

  return (
    <div className="mt-2 border border-base-300/60 rounded p-2 bg-base-100 text-[11px]" data-testid="ai-entity-diff">
      <div className="text-[10px] font-bold uppercase tracking-wider text-base-content/50 mb-1">Diff: existing → proposed</div>
      {fieldRows.length > 0 && (
        <table className="w-full font-mono">
          <tbody>
            {fieldRows.map(r => (
              <tr key={r.label}>
                <td className="text-base-content/40 pr-2 align-top">{r.label}</td>
                <td className="text-error/80 line-through align-top pr-2">{String(r.a ?? '∅')}</td>
                <td className="text-base-content/40">→</td>
                <td className="text-success align-top pl-2">{String(r.b ?? '∅')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {added.length > 0 && (
        <div className="mt-1">
          <div className="text-success text-[10px]">+ Added attributes ({added.length})</div>
          <ul className="font-mono text-success ml-2">
            {added.map(a => <li key={`add-${a.name}`}>+ {a.name}: {a.type || 'string'}{a.required ? ' (required)' : ''}{a.primaryKey ? ' (PK)' : ''}</li>)}
          </ul>
        </div>
      )}
      {removed.length > 0 && (
        <div className="mt-1">
          <div className="text-error text-[10px]">− Removed attributes ({removed.length})</div>
          <ul className="font-mono text-error ml-2">
            {removed.map(a => <li key={`rem-${a.name}`}>− {a.name}: {a.type || 'string'}</li>)}
          </ul>
        </div>
      )}
      {modified.length > 0 && (
        <div className="mt-1">
          <div className="text-warning text-[10px]">~ Modified attributes ({modified.length})</div>
          <ul className="font-mono text-warning ml-2">
            {modified.map(m => (
              <li key={`mod-${m.name}`}>
                ~ {m.name}: <span className="line-through opacity-70">{m.a.type}{m.a.required ? '!' : ''}</span>
                {' → '}{m.b.type}{m.b.required ? '!' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
