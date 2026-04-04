import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface AIChatPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function AIChatPanel({ open, onClose }: AIChatPanelProps) {
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [localMessages, setLocalMessages] = useState<Array<{ id: string; role: string; text: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string>(crypto.randomUUID());
  const [conversationList, setConversationList] = useState<Array<{ id: string; title: string; messageCount: number; updatedAt: string }>>([]);
  const [showHistory, setShowHistory] = useState(false);

  // Check if AI is available (no-store to avoid stale cache)
  useEffect(() => {
    fetch('/api/ai/status', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setAiAvailable(d.available))
      .catch(() => setAiAvailable(false));
  }, [open]);

  // Load conversation list
  useEffect(() => {
    if (open) {
      fetch('/api/ai/conversations').then(r => r.json()).then(d => setConversationList(d.data || [])).catch(() => {});
    }
  }, [open, localMessages.length]);

  // Save conversation after each message
  const saveConversation = useCallback((msgs: typeof localMessages) => {
    if (msgs.length === 0) return;
    const conv = {
      id: conversationId,
      title: msgs.find(m => m.role === 'user')?.text.slice(0, 60) || 'New conversation',
      messages: msgs.map(m => ({ ...m, timestamp: new Date().toISOString() })),
      createdAt: msgs[0]?.id ? new Date().toISOString() : new Date().toISOString(),
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
        setLocalMessages(d.data.messages);
        setShowHistory(false);
      }
    }).catch(() => {});
  }, []);

  const startNewConversation = useCallback(() => {
    setConversationId(crypto.randomUUID());
    setLocalMessages([]);
    setShowHistory(false);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    fetch(`/api/ai/conversations/${id}`, { method: 'DELETE' }).then(() => {
      setConversationList(prev => prev.filter(c => c.id !== id));
      if (id === conversationId) startNewConversation();
    }).catch(() => {});
  }, [conversationId, startNewConversation]);

  const sendToAI = useCallback(async (text: string) => {
    const userMsg = { id: crypto.randomUUID(), role: 'user', text };
    setLocalMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setError(null);

    try {
      // Build UIMessage array for the API
      const allMessages = [...localMessages, userMsg];
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

      // Read SSE stream
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let assistantText = '';
      const assistantId = crypto.randomUUID();
      const toolResults: Array<{ name: string; result: any }> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'text-delta' && data.delta) {
              assistantText += data.delta;
              // Update the assistant message in real-time
              setLocalMessages(prev => {
                const existing = prev.find(m => m.id === assistantId);
                if (existing) {
                  return prev.map(m => m.id === assistantId ? { ...m, text: assistantText } : m);
                }
                return [...prev, { id: assistantId, role: 'assistant', text: assistantText }];
              });
            }

            if (data.type === 'tool-output-available') {
              toolResults.push({ name: data.toolCallId, result: data.output });
              // Handle navigation
              if (data.output?.navigate) {
                navigate(data.output.navigate);
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }

      // If we got tool results but no text, add a summary
      if (!assistantText && toolResults.length > 0) {
        assistantText = toolResults.map(t => {
          if (t.result?.message) return t.result.message;
          if (t.result?.packages) return `Packages: ${t.result.packages.join(', ')}`;
          if (t.result?.entities) return `Found ${t.result.entities.length} entities`;
          return JSON.stringify(t.result);
        }).join('\n');
        setLocalMessages(prev => [...prev, { id: assistantId, role: 'assistant', text: assistantText }]);
      }

      // Ensure assistant message exists even if empty
      if (!assistantText && toolResults.length === 0) {
        setLocalMessages(prev => [...prev, { id: assistantId, role: 'assistant', text: '(No response)' }]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
      // Save after response completes
      setLocalMessages(msgs => { saveConversation(msgs); return msgs; });
    }
  }, [localMessages, navigate, saveConversation]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [localMessages]);

  // Focus input when panel opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendToAI(input.trim());
    setInput('');
  };

  const handleSuggestion = (text: string) => {
    sendToAI(text);
  };

  if (!open) return null;

  return (
    <div className="fixed right-0 top-10 bottom-0 w-96 bg-base-100 border-l border-base-300 shadow-xl z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-base-300 bg-base-200">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-primary" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd" />
          </svg>
          <span className="font-semibold text-sm">AI Assistant</span>
          {isLoading && <span className="loading loading-dots loading-xs text-primary"></span>}
        </div>
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost btn-xs" onClick={startNewConversation} title="New conversation">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
          </button>
          <button className="btn btn-ghost btn-xs" onClick={() => setShowHistory(!showHistory)} title="History">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <button className="btn btn-ghost btn-xs btn-circle" onClick={onClose}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {aiAvailable === false && (
          <div className="alert alert-warning text-xs">
            <span>AI not configured. Go to <a href="/settings" className="link">Settings</a> to set up your AI provider and API key.</span>
          </div>
        )}

        {showHistory && (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-base-content/60 mb-2">Conversation History</div>
            {conversationList.length === 0 ? (
              <div className="text-xs text-base-content/40">No saved conversations</div>
            ) : conversationList.map(conv => (
              <div key={conv.id} className="flex items-center gap-2 group">
                <button
                  className={`btn btn-xs btn-block justify-start text-left font-normal flex-1 ${conv.id === conversationId ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => loadConversation(conv.id)}
                >
                  <span className="truncate">{conv.title}</span>
                  <span className="text-xs opacity-50 ml-auto">{conv.messageCount}</span>
                </button>
                <button
                  className="btn btn-xs btn-ghost text-error opacity-0 group-hover:opacity-100"
                  onClick={() => deleteConversation(conv.id)}
                >
                  &times;
                </button>
              </div>
            ))}
            <div className="divider my-1"></div>
          </div>
        )}

        {localMessages.length === 0 && aiAvailable && !showHistory && (
          <div className="text-center text-base-content/50 mt-8 space-y-3">
            <p className="text-sm">Ask me to help with your data model.</p>
            <div className="space-y-2">
              {[
                'Create an e-commerce data model',
                'Add a Product entity with common attributes',
                'Show me all entities',
                'What stereotypes are available?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  className="btn btn-xs btn-outline btn-block justify-start text-left font-normal"
                  onClick={() => handleSuggestion(suggestion)}
                  disabled={isLoading}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {localMessages.map((msg) => (
          <div key={msg.id} className={`chat ${msg.role === 'user' ? 'chat-end' : 'chat-start'}`}>
            <div className={`chat-bubble text-sm whitespace-pre-wrap ${
              msg.role === 'user' ? 'chat-bubble-primary' : ''
            }`}>
              {msg.text}
            </div>
          </div>
        ))}

        {error && (
          <div className="alert alert-error text-xs">
            <span>{error}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-base-300">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            className="input input-sm input-bordered flex-1"
            placeholder={aiAvailable ? "Ask about your data model..." : "AI not configured"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!aiAvailable || isLoading}
          />
          <button
            type="submit"
            className="btn btn-sm btn-primary"
            disabled={!aiAvailable || isLoading || !input.trim()}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
