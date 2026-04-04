import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';

interface AIChatPanelProps {
  open: boolean;
  onClose: () => void;
}

interface ToolCall {
  id: string;
  name: string;
  input: any;
  output: any;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCall[];
  rawEvents?: any[];
}

type PanelView = 'chat' | 'history' | 'raw';

export default function AIChatPanel({ open, onClose }: AIChatPanelProps) {
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string>(crypto.randomUUID());
  const [conversationList, setConversationList] = useState<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>([]);
  const [view, setView] = useState<PanelView>('chat');
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);

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

  const sendToAI = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    try {
      const allMessages = [...messages, userMsg];
      const apiMessages = allMessages.map(m => ({
        id: m.id,
        role: m.role,
        parts: [{ type: 'text', text: m.text }],
      }));

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || 'AI request failed');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let assistantText = '';
      const assistantId = crypto.randomUUID();
      const toolCalls: ToolCall[] = [];
      const rawEvents: any[] = [];
      const pendingTools: Record<string, ToolCall> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));
            rawEvents.push(data);

            if (data.type === 'text-delta' && data.delta) {
              assistantText += data.delta;
              setMessages(prev => {
                const existing = prev.find(m => m.id === assistantId);
                if (existing) {
                  return prev.map(m => m.id === assistantId ? { ...m, text: assistantText, toolCalls: [...toolCalls], rawEvents: [...rawEvents] } : m);
                }
                return [...prev, { id: assistantId, role: 'assistant', text: assistantText, toolCalls: [...toolCalls], rawEvents: [...rawEvents] }];
              });
            }

            if (data.type === 'tool-input-available') {
              pendingTools[data.toolCallId] = {
                id: data.toolCallId,
                name: data.toolName,
                input: data.input,
                output: null,
              };
            }

            if (data.type === 'tool-output-available') {
              if (pendingTools[data.toolCallId]) {
                pendingTools[data.toolCallId].output = data.output;
                toolCalls.push(pendingTools[data.toolCallId]);
                delete pendingTools[data.toolCallId];
              } else {
                toolCalls.push({ id: data.toolCallId, name: data.toolCallId, input: null, output: data.output });
              }

              // Update message with tool calls
              setMessages(prev => {
                const existing = prev.find(m => m.id === assistantId);
                if (existing) {
                  return prev.map(m => m.id === assistantId ? { ...m, toolCalls: [...toolCalls], rawEvents: [...rawEvents] } : m);
                }
                return [...prev, { id: assistantId, role: 'assistant', text: assistantText, toolCalls: [...toolCalls], rawEvents: [...rawEvents] }];
              });

              if (data.output?.navigate) {
                navigate(data.output.navigate);
              }
            }
          } catch {
            // Skip
          }
        }
      }

      // Ensure message exists
      if (!assistantText && toolCalls.length > 0) {
        assistantText = toolCalls.map(t => {
          if (t.output?.message) return `- ${t.output.message}`;
          if (t.output?.packages) return `**Packages:** ${t.output.packages.join(', ')}`;
          if (t.output?.entities) return `Found **${t.output.entities.length}** entities`;
          if (t.output?.stereotypes) return t.output.stereotypes.map((s: any) => `- **${s.name}** (${s.appliesTo}): ${s.fields?.join(', ') || ''}`).join('\n');
          return `\`\`\`json\n${JSON.stringify(t.output, null, 2)}\n\`\`\``;
        }).join('\n\n');
        setMessages(prev => [...prev, { id: assistantId, role: 'assistant', text: assistantText, toolCalls, rawEvents }]);
      } else if (!assistantText) {
        setMessages(prev => [...prev, { id: assistantId, role: 'assistant', text: '*(No response)*', rawEvents }]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
      setMessages(msgs => { saveConversation(msgs); return msgs; });
    }
  }, [messages, navigate, saveConversation]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
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
          <div className="w-px h-4 bg-base-300 mx-1"></div>
          <button className="btn btn-ghost btn-xs" onClick={startNewConversation} title="New">+</button>
          <button className="btn btn-ghost btn-xs" onClick={onClose} title="Close">&times;</button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
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
                    <span>{msg.text}</span>
                  ) : (
                    <div className="prose prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0 [&_pre]:my-1 [&_code]:text-xs [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm">
                      <Markdown>{msg.text}</Markdown>
                    </div>
                  )}
                </div>

                {/* Tool calls */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {msg.toolCalls.map(tc => (
                      <div key={tc.id} className="border border-base-300/50 rounded bg-base-200/30 text-xs">
                        <button
                          className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-base-200/60 text-left"
                          onClick={() => toggleTool(tc.id)}
                        >
                          <span className={`text-[10px] ${tc.output?.success === false ? 'text-error' : 'text-success'}`}>
                            {tc.output?.success === false ? '✗' : '✓'}
                          </span>
                          <span className="font-mono text-primary/80">{tc.name.replace('functions.', '').split(':')[0]}</span>
                          {tc.output?.message && <span className="text-base-content/50 truncate flex-1 font-sans">{tc.output.message}</span>}
                          <span className="text-base-content/30">{expandedTools.has(tc.id) ? '▼' : '▶'}</span>
                        </button>
                        {expandedTools.has(tc.id) && (
                          <div className="px-2 pb-2 space-y-1">
                            {tc.input && (
                              <div>
                                <div className="text-[10px] text-base-content/40 uppercase mb-0.5">Input</div>
                                <pre className="bg-base-300/30 rounded p-1.5 overflow-x-auto text-[11px]">{JSON.stringify(tc.input, null, 2)}</pre>
                              </div>
                            )}
                            <div>
                              <div className="text-[10px] text-base-content/40 uppercase mb-0.5">Output</div>
                              <pre className="bg-base-300/30 rounded p-1.5 overflow-x-auto text-[11px]">{JSON.stringify(tc.output, null, 2)}</pre>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
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
              <div className="bg-error/10 border border-error/30 rounded px-3 py-2 text-xs text-error">{error}</div>
            )}

            <div ref={messagesEndRef} />
          </div>
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
      </div>

      {/* Input — IDE style */}
      <form onSubmit={handleSubmit} className="px-3 py-2 border-t border-base-300 bg-base-200/30">
        <div className="flex gap-1.5">
          <span className="text-primary self-center text-xs">&gt;</span>
          <input
            ref={inputRef}
            type="text"
            className="input input-xs input-ghost flex-1 font-mono focus:outline-none bg-transparent pl-0"
            placeholder={aiAvailable ? "Ask about your data model..." : "AI not configured"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!aiAvailable || isLoading}
          />
          <button
            type="submit"
            className="btn btn-xs btn-primary btn-square"
            disabled={!aiAvailable || isLoading || !input.trim()}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
