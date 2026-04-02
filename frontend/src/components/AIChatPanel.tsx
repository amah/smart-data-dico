import { useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { useNavigate } from 'react-router-dom';

interface AIChatPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function AIChatPanel({ open, onClose }: AIChatPanelProps) {
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);

  // Check if AI is available
  useEffect(() => {
    fetch('/api/ai/status')
      .then(r => r.json())
      .then(d => setAiAvailable(d.available))
      .catch(() => setAiAvailable(false));
  }, []);

  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: '/api/ai/chat',
    onToolCall: ({ toolCall }) => {
      // Handle navigation from tool results
      const result = toolCall as any;
      if (result?.result?.navigate) {
        navigate(result.result.navigate);
      }
    },
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle navigation hints in assistant messages (tool results)
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg.parts) {
      for (const part of lastMsg.parts) {
        if (part.type === 'tool-invocation' && (part as any).result?.navigate) {
          navigate((part as any).result.navigate);
        }
      }
    }
  }, [messages, navigate]);

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
            <span>AI not configured. Set <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code> environment variable.</span>
          </div>
        )}

        {messages.length === 0 && aiAvailable && (
          <div className="text-center text-base-content/50 mt-8 space-y-3">
            <p className="text-sm">Ask me to help with your data model.</p>
            <div className="space-y-2">
              {[
                'Create an e-commerce data model',
                'Add a Product entity with common attributes',
                'Show me all entities in claims-processing',
                'What stereotypes are available?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  className="btn btn-xs btn-outline btn-block justify-start text-left font-normal"
                  onClick={() => {
                    const fakeEvent = { preventDefault: () => {} } as any;
                    handleInputChange({ target: { value: suggestion } } as any);
                    // Small delay to let state update before submit
                    setTimeout(() => {
                      const form = document.querySelector('#ai-chat-form') as HTMLFormElement;
                      form?.requestSubmit();
                    }, 50);
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat ${msg.role === 'user' ? 'chat-end' : 'chat-start'}`}>
            <div className={`chat-bubble text-sm ${
              msg.role === 'user' ? 'chat-bubble-primary' : 'chat-bubble-neutral'
            }`}>
              {/* Render text parts */}
              {msg.parts?.map((part, i) => {
                if (part.type === 'text') {
                  return <span key={i}>{part.text}</span>;
                }
                if (part.type === 'tool-invocation') {
                  const toolPart = part as any;
                  const result = toolPart.result;
                  if (!result) return null;

                  if (toolPart.toolName === 'navigateTo') {
                    return (
                      <div key={i} className="mt-1 text-xs opacity-70 italic">
                        Navigated to {result.reason}
                      </div>
                    );
                  }

                  if (result.success !== undefined) {
                    return (
                      <div key={i} className="mt-1 badge badge-xs gap-1 badge-ghost">
                        {result.success ? '✓' : '✗'} {result.message || result.error}
                      </div>
                    );
                  }
                  return null;
                }
                return null;
              }) || msg.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="chat chat-start">
            <div className="chat-bubble chat-bubble-neutral text-sm">
              <span className="loading loading-dots loading-xs"></span>
            </div>
          </div>
        )}

        {error && (
          <div className="alert alert-error text-xs">
            <span>{error.message}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form id="ai-chat-form" onSubmit={handleSubmit} className="p-3 border-t border-base-300">
        <div className="flex gap-2">
          <input
            type="text"
            className="input input-sm input-bordered flex-1"
            placeholder={aiAvailable ? "Ask about your data model..." : "AI not configured"}
            value={input}
            onChange={handleInputChange}
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
