import { cloneElement, isValidElement, ReactNode, useRef, useState, useSyncExternalStore, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';

// Matches the same @-token shape the composer / mentions/search backend use.
// One char letter prefix, then up to 29 word/hyphen chars.
export const MENTION_RE = /@[A-Za-z][\w-]{0,29}/g;

interface EntityPreview {
  name: string;
  packageName: string;
  attributeCount: number;
  stereotype?: string;
  status?: string;
}

type CacheEntry =
  | { state: 'loading' }
  | { state: 'resolved'; data: EntityPreview }
  | { state: 'unknown' }
  | { state: 'error' };

// Module-level cache so a chat with 20 @Order references makes one fetch,
// not twenty. Keyed by lowercased entity name to match the resolver.
const cache = new Map<string, CacheEntry>();
const subscribers = new Map<string, Set<() => void>>();

function notify(key: string) {
  subscribers.get(key)?.forEach(fn => fn());
}

function subscribe(key: string, cb: () => void) {
  const sub = subscribers.get(key) || new Set();
  sub.add(cb);
  subscribers.set(key, sub);
  return () => {
    sub.delete(cb);
    if (sub.size === 0) subscribers.delete(key);
  };
}

function getSnapshot(key: string): CacheEntry | undefined {
  return cache.get(key);
}

async function resolveEntity(name: string): Promise<void> {
  const key = name.toLowerCase();
  const existing = cache.get(key);
  if (existing && existing.state !== 'error') return;
  cache.set(key, { state: 'loading' });
  notify(key);
  try {
    const searchRes = await fetch(`/api/ai/mentions/search?q=${encodeURIComponent(name)}`);
    if (!searchRes.ok) throw new Error(`mentions search ${searchRes.status}`);
    const searchJson = await searchRes.json();
    const ent = (searchJson?.data?.entities || []).find(
      (e: { name: string }) => e.name.toLowerCase() === key,
    );
    if (!ent) {
      cache.set(key, { state: 'unknown' });
      notify(key);
      return;
    }
    const detailRes = await fetch(
      `/api/services/${encodeURIComponent(ent.packageName)}/entities/${encodeURIComponent(ent.name)}`,
    );
    if (!detailRes.ok) throw new Error(`entity ${detailRes.status}`);
    const detailJson = await detailRes.json();
    const data = detailJson?.data || detailJson;
    cache.set(key, {
      state: 'resolved',
      data: {
        name: ent.name,
        packageName: ent.packageName,
        attributeCount: Array.isArray(data?.attributes) ? data.attributes.length : 0,
        stereotype: data?.stereotype,
        status: data?.status,
      },
    });
  } catch {
    cache.set(key, { state: 'error' });
  } finally {
    notify(key);
  }
}

interface EntityMentionProps {
  name: string;
}

/**
 * Inline `@EntityName` pill in chat. Hovering pops a small detail card
 * (name, package, attribute count, stereotype, status); clicking
 * navigates to the entity detail page. Reuses the #54 mention resolver
 * via /api/ai/mentions/search → /api/services/<pkg>/entities/<name>.
 *
 * Resolution is lazy: triggered on first hover (or first focus for keyboard
 * users). Per-name results are cached at module level so repeated mentions
 * don't re-fetch. A name that doesn't resolve renders as plain `@Name`
 * text instead of a broken link.
 */
export default function EntityMention({ name }: EntityMentionProps) {
  const navigate = useNavigate();
  const [hover, setHover] = useState(false);
  const hasResolved = useRef(false);

  const key = name.toLowerCase();
  // useSyncExternalStore gives React full control over re-renders driven
  // by the module-level cache, which keeps test runs free of stray
  // unwrapped state updates from in-flight fetches.
  const entry = useSyncExternalStore(
    cb => subscribe(key, cb),
    () => getSnapshot(key),
    () => undefined,
  );

  const triggerResolve = () => {
    if (hasResolved.current) return;
    hasResolved.current = true;
    resolveEntity(name);
  };

  const resolved = entry?.state === 'resolved' ? entry.data : null;
  const unknown = entry?.state === 'unknown';

  // Unresolved or unknown — just render plain text. Don't pretend to be
  // a link to something the user can't navigate to.
  if (unknown) {
    return <span data-testid="entity-mention-unknown">@{name}</span>;
  }

  const onClick = (e: MouseEvent) => {
    if (!resolved) return;
    e.preventDefault();
    e.stopPropagation();
    navigate(`/packages/${encodeURIComponent(resolved.packageName)}/entities/${encodeURIComponent(resolved.name)}`);
  };

  return (
    <span
      className="relative inline-block group/mention"
      onMouseEnter={() => { triggerResolve(); setHover(true); }}
      onMouseLeave={() => setHover(false)}
      onFocus={triggerResolve}
    >
      <a
        href={resolved ? `/packages/${encodeURIComponent(resolved.packageName)}/entities/${encodeURIComponent(resolved.name)}` : '#'}
        onClick={onClick}
        className="text-primary font-medium hover:underline cursor-pointer"
        data-testid="entity-mention"
        data-entity-name={name}
      >
        @{name}
      </a>
      {hover && resolved && (
        <span
          role="tooltip"
          data-testid="entity-mention-card"
          className="absolute z-50 left-0 top-full mt-1 w-64 p-2 bg-base-100 border border-base-300 rounded shadow-lg text-xs text-base-content normal-case font-sans"
          onMouseEnter={() => setHover(true)}
        >
          <span className="block font-semibold text-sm">{resolved.name}</span>
          <span className="block text-base-content/60 mt-0.5">in {resolved.packageName}</span>
          <span className="block mt-1.5">
            {resolved.attributeCount} {resolved.attributeCount === 1 ? 'attribute' : 'attributes'}
          </span>
          {resolved.stereotype && (
            <span className="block mt-0.5">
              <span className="badge badge-xs badge-ghost">{resolved.stereotype}</span>
            </span>
          )}
          {resolved.status && (
            <span className="block text-base-content/60 mt-0.5">status: {resolved.status}</span>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * Walk a ReactNode tree and replace `@EntityName` substrings inside any
 * string leaf with an <EntityMention/>. Preserves all other nodes
 * (elements, fragments, numbers, etc.) untouched. Used as the children
 * transformer inside react-markdown component overrides.
 *
 * Exported for direct unit testing — the recursive shape is the easy
 * place to introduce regressions.
 */
export function processMentions(children: ReactNode): ReactNode {
  return walk(children, 'm');
}

function walk(node: ReactNode, path: string): ReactNode {
  if (typeof node === 'string') {
    return splitMentions(node, path);
  }
  if (Array.isArray(node)) {
    return node.map((c, i) => {
      const out = walk(c, `${path}-${i}`);
      // If the child wasn't an element, we may need a key — but
      // strings/fragments don't take keys; relying on parent array
      // index is fine here since this is a pure render path.
      return out;
    });
  }
  if (isValidElement(node)) {
    const props = (node as { props: { children?: ReactNode } }).props;
    if (props && 'children' in props && props.children !== undefined) {
      return cloneElement(node, undefined, walk(props.children, `${path}-c`));
    }
  }
  return node;
}

function splitMentions(text: string, path: string): ReactNode {
  if (!text.includes('@')) return text;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  // Reset the regex's lastIndex — RE is module-level and stateful when /g.
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = MENTION_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<EntityMention key={`${path}-${i}`} name={match[0].slice(1)} />);
    lastIndex = match.index + match[0].length;
    i += 1;
  }
  if (parts.length === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

// Test-only: clear the in-memory cache so adjacent tests don't bleed.
export function __resetEntityMentionCache() {
  cache.clear();
  subscribers.clear();
}

