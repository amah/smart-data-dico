import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
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
import { usePrefs } from '../hooks/usePrefs';
import {
  AIToolCategory,
  loadPolicy,
  shouldAutoApprove,
} from '../utils/aiAutoApprovePolicy';

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
}

type PanelView = 'chat' | 'history' | 'raw' | 'tools';

export default function AIChatPanel({ open, onClose }: AIChatPanelProps) {
  const navigate = useNavigate();
  const { theme } = usePrefs();
  const isDark = theme === 'dark';
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string>(crypto.randomUUID());
  const [conversationList, setConversationList] = useState<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>([]);
  const [view, setView] = useState<PanelView>('chat');
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  // Tracks which error-state tool cards have "Show raw" expanded (separate
  // from the per-card expand toggle so the raw-output toggle survives
  // between user clicks). #61
  const [rawShownTools, setRawShownTools] = useState<Set<string>>(new Set());
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [toolDefs, setToolDefs] = useState<Array<{ name: string; description: string; parameters: Array<{ name: string; type: string; required: boolean; description: string }> }>>([]);
  // Granular per-category auto-approve policy (#59). Loaded once on
  // mount; the Settings page is the only place that mutates it. The
  // legacy `ai-auto-approve` boolean is migrated by loadPolicy().
  const [policy, setPolicy] = useState(() => loadPolicy());
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
    fetch('/api/ai/status', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setAiAvailable(d.available))
      .catch(() => setAiAvailable(false));
  }, [open]);

  // Load conversation list and auto-resume the most recent one on first open
  const hasAutoLoaded = useRef(false);
  useEffect(() => {
    if (open) {
      fetch('/api/ai/conversations').then(r => r.json()).then(d => {
        const list = d.data || [];
        setConversationList(list);
        // Auto-load the most recent conversation on first open if no messages yet
        if (!hasAutoLoaded.current && messages.length === 0 && list.length > 0) {
          hasAutoLoaded.current = true;
          loadConversation(list[0].id);
        }
      }).catch(() => {});
    }
  }, [open, messages.length]);

  const saveConversation = useCallback((msgs: ChatMessage[]) => {
    if (msgs.length === 0) return;
    const conv = {
      id: conversationId,
      title: msgs.find(m => m.role === 'user')?.text.slice(0, 60) || 'New conversation',
      messages: msgs.map(m => ({ ...m, timestamp: new Date().toISOString() })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fetch('/api/ai/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conv),
    }).catch(() => {});
  }, [conversationId]);

  const loadConversation = useCallback((id: string) => {
    fetch(`/api/ai/conversations/${id}`).then(r => r.json()).then(d => {
      if (d.data) {
        setConversationId(d.data.id);
        setMessages(d.data.messages);
        setView('chat');
      }
    }).catch(() => {});
  }, []);

  const startNewConversation = useCallback(() => {
    setConversationId(crypto.randomUUID());
    setMessages([]);
    setView('chat');
  }, []);

  const deleteConversation = useCallback((id: string) => {
    fetch(`/api/ai/conversations/${id}`, { method: 'DELETE' }).then(() => {
      setConversationList(prev => prev.filter(c => c.id !== id));
      if (id === conversationId) startNewConversation();
    }).catch(() => {});
  }, [conversationId, startNewConversation]);

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
    setError(null);
    // New user send unlocks auto-scroll: we want the viewport to
    // follow the response. (#126)
    setScrollLocked(false);
    setHasUnseenDeltas(false);

    // Set up an AbortController so the Stop button (and unmount) can
    // tear down the in-flight stream and break the agentic loop. (#61)
    const ac = new AbortController();
    abortControllerRef.current = ac;

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

    const pushToolUpdate = () => {
      const toolCalls = toolOrder.map(id => toolMap[id]).filter(Boolean);
      setMessages(prev => {
        const existing = prev.find(m => m.id === assistantId);
        if (existing) {
          return prev.map(m => m.id === assistantId
            ? { ...m, text: assistantText, toolCalls: [...toolCalls], rawEvents: [...rawEvents], cancelled }
            : m);
        }
        return [...prev, { id: assistantId, role: 'assistant', text: assistantText, toolCalls: [...toolCalls], rawEvents: [...rawEvents], cancelled }];
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

    try {
      const allMessages = [...baseHistory, userMsg];
      const apiMessages = allMessages.map(m => ({
        id: m.id,
        role: m.role,
        parts: [{ type: 'text', text: m.text }],
      }));

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
        signal: ac.signal,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'AI request failed');
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

            if (data.type === 'cancelled') {
              cancelled = true;
              sweepInflightTools();
              pushToolUpdate();
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
                  status: 'running',
                  // Prefer the existing category (set by tool-input-start)
                  // but accept the available event's value if it's the
                  // first time we're seeing it.
                  category: toolMap[data.toolCallId].category ?? (data.category as AIToolCategory | undefined),
                };
              }
              pushToolUpdate();
            }

            if (data.type === 'tool-output-available' && data.toolCallId) {
              if (!toolMap[data.toolCallId]) {
                toolMap[data.toolCallId] = {
                  id: data.toolCallId,
                  name: data.toolCallId,
                  input: null,
                  output: data.output,
                  status: undefined,
                };
                toolOrder.push(data.toolCallId);
              } else {
                toolMap[data.toolCallId] = {
                  ...toolMap[data.toolCallId],
                  output: data.output,
                  status: undefined,
                };
              }
              pushToolUpdate();

              if (data.output?.navigate) {
                navigate(data.output.navigate);
              }
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

      const toolCalls = toolOrder.map(id => toolMap[id]).filter(Boolean);

      // Ensure assistant message exists with sensible default text
      if (!assistantText && toolCalls.length > 0) {
        assistantText = toolCalls.map(t => {
          if (t.output?.success === false && t.output?.error) return `**Error in ${t.name}:** ${t.output.error}`;
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

      // Apply per-category auto-approve policy (#59). Tools in
      // categories the user has set to 'review' (or 'off' for delete)
      // are flipped to status='pending'; tools in 'auto' categories
      // keep their terminal state. We only override terminal-good
      // states — error / cancelled / undone tools are left alone.
      if (toolCalls.length > 0) {
        let anyPending = false;
        const adjusted = toolCalls.map(tc => {
          // Don't second-guess non-terminal-good states.
          const isTerminalNonOk =
            tc.status === 'undone' ||
            tc.status === 'cancelled' ||
            (tc.output && tc.output.success === false);
          if (isTerminalNonOk) return tc;
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
      setMessages(msgs => { saveConversation(msgs); return msgs; });
    }
  }, [messages, navigate, saveConversation, policy]);

  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const refreshApp = useCallback(() => {
    // Trigger sidebar refresh by reloading the page data
    window.dispatchEvent(new CustomEvent('app:data-changed'));
    // Force reload sidebar data
    setTimeout(() => window.location.reload(), 500);
  }, []);

  const approveAllTools = useCallback((msgId: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id === msgId && m.toolCalls) {
        return { ...m, toolCalls: m.toolCalls.map(tc => ({ ...tc, status: 'approved' as const })) };
      }
      return m;
    }));
    setPendingReview(false);
    refreshApp();
  }, [refreshApp]);

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

  // Load tool definitions
  useEffect(() => {
    if (view === 'tools' && toolDefs.length === 0) {
      fetch('/api/ai/tools').then(r => r.json()).then(d => setToolDefs(d.data || [])).catch(() => {});
    }
  }, [view]);

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
    setError(null);
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
    setError(null);
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
    <div className="fixed right-0 top-10 bottom-0 w-[420px] bg-base-100 border-l border-base-300 shadow-xl z-40 flex flex-col font-mono text-[13px]">
      {/* Header — IDE style */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-base-300 bg-base-200/80">
        <div className="flex items-center gap-2">
          <span className="text-primary font-bold text-xs tracking-wide">AI ASSISTANT</span>
          {isLoading && <span className="loading loading-dots loading-xs text-primary"></span>}
        </div>
        <div className="flex items-center gap-0.5">
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
                        components={{
                          code({ inline, className, children, ...rest }: any) {
                            const lang = /language-(\w+)/.exec(className || '')?.[1];
                            if (inline || !lang) {
                              return <code className={className} {...rest}>{children}</code>;
                            }
                            const code = String(children).replace(/\n$/, '');
                            const isCopied = copiedKey === code;
                            const isCopyFailed = copyFailedKey === code;
                            return (
                              <div className="relative group/code">
                                <button
                                  type="button"
                                  className={`btn btn-xs btn-ghost absolute right-1 top-1 transition-opacity ${
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
                        }}
                      >{msg.text}</Markdown>
                    </div>
                  )}
                </div>

                {/* Tool calls */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (() => {
                  const total = msg.toolCalls.length;
                  // "completed" = anything past the running/starting phase.
                  // Cancelled cards are terminal and count as complete so the
                  // progress counter can settle. (#61)
                  const completed = msg.toolCalls.filter(tc => tc.status !== 'starting' && tc.status !== 'running').length;
                  const showProgress = total > 1 && completed < total;
                  return (
                  <div className="mt-1.5 space-y-1">
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
                               tc.output?.message || ''}
                            </span>
                            <span className="text-base-content/30">{expandedTools.has(tc.id) ? '▼' : '▶'}</span>
                          </button>
                          {tc.status === 'pending' && (
                            <button className="btn btn-xs btn-error btn-ghost" onClick={() => undoToolCall(msg.id, tc.id)} title="Undo this action">
                              ↩
                            </button>
                          )}
                        </div>

                        {/* Inline error message for failed tool calls — visible
                            even when the card is collapsed. (#61 comment B) */}
                        {isError && (
                          <div className="px-2 pb-2 -mt-0.5">
                            <div className="bg-error/10 border border-error/30 rounded px-2 py-1 text-[11px] text-error font-sans">
                              {tc.output.error || 'Tool failed'}
                            </div>
                            <button
                              className="text-[10px] text-base-content/50 hover:text-base-content mt-1 underline"
                              onClick={() => toggleRaw(tc.id)}
                            >
                              {rawShownTools.has(tc.id) ? 'Hide raw' : 'Show raw'}
                            </button>
                            {rawShownTools.has(tc.id) && (
                              <pre className="mt-1 bg-base-300/30 rounded p-1.5 overflow-x-auto text-[11px]">{JSON.stringify(tc.output, null, 2)}</pre>
                            )}
                          </div>
                        )}

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
                                <pre className="bg-base-300/30 rounded p-1.5 overflow-x-auto text-[11px]">{JSON.stringify(tc.output, null, 2)}</pre>
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

                    {/* Approve all / Undo all bar */}
                    {msg.toolCalls.some(tc => tc.status === 'pending') && (
                      <div className="flex items-center gap-2 mt-2 p-2 bg-warning/10 border border-warning/30 rounded">
                        <span className="text-[10px] font-bold text-warning uppercase flex-1">Review required</span>
                        <button className="btn btn-xs btn-success" onClick={() => approveAllTools(msg.id)}>Approve All</button>
                        <button className="btn btn-xs btn-error btn-outline" onClick={() => {
                          msg.toolCalls?.filter(tc => tc.status === 'pending').forEach(tc => undoToolCall(msg.id, tc.id));
                        }}>Undo All</button>
                      </div>
                    )}
                  </div>
                  );
                })()}
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
              <div className="bg-error/10 border border-error/30 rounded px-3 py-2 text-xs text-error flex items-center gap-2">
                <span className="flex-1">{error}</span>
                <button
                  type="button"
                  className="btn btn-xs btn-error btn-outline"
                  data-testid="ai-retry-button"
                  onClick={retryLast}
                  disabled={isLoading}
                >
                  Retry
                </button>
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
          <div className="p-3 space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-base-content/50 mb-2">Conversations</div>
            {conversationList.length === 0 ? (
              <div className="text-xs text-base-content/30 text-center mt-8">No saved conversations</div>
            ) : conversationList.map(conv => (
              <div key={conv.id} className="flex items-center gap-1 group">
                <button
                  className={`btn btn-xs btn-block justify-start text-left font-sans font-normal flex-1 ${conv.id === conversationId ? 'btn-primary btn-outline' : 'btn-ghost'}`}
                  onClick={() => loadConversation(conv.id)}
                >
                  <span className="truncate flex-1">{conv.title}</span>
                  <span className="badge badge-xs badge-ghost">{conv.messageCount}</span>
                </button>
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
      </div>

      {/* Input — IDE style */}
      <form onSubmit={handleSubmit} className="px-3 py-2 border-t border-base-300 bg-base-200/30">
        <div className="flex gap-1.5 items-end">
          <span className="text-primary text-xs pb-1">&gt;</span>
          <textarea
            ref={inputRef}
            rows={1}
            className="textarea textarea-ghost textarea-xs flex-1 font-mono focus:outline-none bg-transparent pl-0 resize-none min-h-[1.5rem] py-1"
            placeholder={aiAvailable ? "Ask about your data model... (⌘↵ send · ⇧↵ newline)" : "AI not configured"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            disabled={!aiAvailable || isLoading}
            data-testid="ai-composer-input"
            title="⌘↵ / Ctrl↵ send · ⇧↵ newline · ⌘K focus chat"
          />
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
      </form>
    </div>
  );
}
