import { useEffect, useRef, useState } from 'react';

/**
 * Renders a Mermaid diagram from source. Used to turn ```mermaid fenced blocks
 * in assistant messages (and generateMermaid tool results) into rendered SVG.
 *
 * mermaid is imported lazily so it code-splits into its own chunk and only
 * loads the first time a diagram actually renders. On a parse/render error we
 * fall back to showing the raw source so the user still gets the diagram text.
 */

// Monotonic id so each render targets a unique element (mermaid keys by id).
let seq = 0;

export default function MermaidDiagram({ code, isDark }: { code: string; isDark?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Defensive: valid Mermaid never contains a ``` fence, so if the model
  // produced sloppy markdown (text after a closing fence merging two blocks
  // into one) keep only the first diagram up to the stray fence.
  const src = code.split('```')[0].trim();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'strict',
          fontFamily: 'inherit',
        });
        const { svg } = await mermaid.render(`mermaid-svg-${++seq}`, src);
        if (cancelled) return;
        setError(null);
        if (ref.current) ref.current.innerHTML = svg;
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        if (ref.current) ref.current.innerHTML = '';
      }
    })();
    return () => { cancelled = true; };
  }, [src, isDark]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(src);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div
      className="relative group/mermaid my-1 rounded border border-base-300 bg-base-100 p-2 overflow-x-auto"
      data-testid="mermaid-diagram"
    >
      <button
        type="button"
        onClick={copy}
        className="btn btn-xs btn-ghost absolute right-1 top-1 z-10 opacity-0 group-hover/mermaid:opacity-100"
        title="Copy diagram source"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      {error ? (
        <div data-testid="mermaid-error">
          <div className="text-error text-xs mb-1">Could not render diagram: {error}</div>
          <pre className="text-[11px] whitespace-pre-wrap">{src}</pre>
        </div>
      ) : (
        <div ref={ref} className="flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" />
      )}
    </div>
  );
}
