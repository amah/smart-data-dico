/**
 * SpotlightSearch — the top-bar live search.
 *
 * Replaces the old button-that-navigates with a real input backed by an
 * in-memory Fuse.js index (see plugins/search/services/searchIndex). The index
 * is built lazily on first focus from `getAllPackages()` + the stereotype list,
 * then cached in a module singleton so re-opening is instant.
 *
 * - Typeahead: fuzzy, case-insensitive suggestions update as you type.
 * - ↑/↓ moves the active suggestion, Enter opens it, Esc closes.
 * - Enter with no active suggestion opens the full /search page for the query.
 * - `/` focuses the input (global shortcut; ⌘K is reserved for the AI chat).
 *
 * Styling uses design tokens (var(--…)) + the shared Icon primitive, matching
 * the surrounding Navbar.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Fuse from 'fuse.js';
import { entityApi, stereotypeApi } from '../services/api';
import { Icon } from './ui';
import {
  buildRecords,
  createSearchIndex,
  rankedSearch,
  type IndexRecord,
  type RecordKind,
} from '../plugins/search/services/searchIndex';

/** Module-level cache so the index survives remounts; rebuilt on demand. */
let cachedIndex: Fuse<IndexRecord> | null = null;
let buildingPromise: Promise<Fuse<IndexRecord>> | null = null;

async function getIndex(): Promise<Fuse<IndexRecord>> {
  if (cachedIndex) return cachedIndex;
  if (buildingPromise) return buildingPromise;
  buildingPromise = (async () => {
    const [packages, stereotypes] = await Promise.all([
      entityApi.getAllPackages().catch(() => []),
      stereotypeApi.getAll('entity').catch(() => []),
    ]);
    cachedIndex = createSearchIndex(buildRecords(packages, stereotypes));
    return cachedIndex;
  })();
  return buildingPromise;
}

/** Invalidate the cache (e.g. after a project switch). */
export function resetSpotlightIndex(): void {
  cachedIndex = null;
  buildingPromise = null;
}

const KIND_LABEL: Record<RecordKind, string> = {
  entity: 'Entity',
  attribute: 'Attribute',
  package: 'Package',
  relationship: 'Relationship',
  metadata: 'Metadata',
  case: 'Case',
  stereotype: 'Stereotype',
};

const KIND_BADGE: Record<RecordKind, string> = {
  entity: 'var(--accent)',
  attribute: 'var(--info, #3b82f6)',
  package: 'var(--warning, #d97706)',
  relationship: 'var(--success, #16a34a)',
  metadata: 'var(--text-subtle)',
  case: 'var(--text-subtle)',
  stereotype: 'var(--text-subtle)',
};

export default function SpotlightSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<IndexRecord[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fuseRef = useRef<Fuse<IndexRecord> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Warm the index on first focus. `ready` flips when the Fuse index is built,
  // re-triggering the search effect for whatever the user has typed by then
  // (the index often finishes loading after the last keystroke).
  const ensureIndex = async () => {
    if (fuseRef.current) return;
    setLoading(true);
    try {
      fuseRef.current = await getIndex();
      setReady(true);
    } finally {
      setLoading(false);
    }
  };

  // Debounced query → results. Re-runs when the index becomes ready.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const fuse = fuseRef.current;
      if (!fuse) return;
      setResults(rankedSearch(fuse, query));
      setActive(0);
    }, 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, ready]);

  // Close on outside click.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Global "/" to focus search — always on (the shared shortcuts hook is
  // opt-in, and ⌘K is reserved for the AI chat), and inert while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
      void ensureIndex();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (record: IndexRecord) => {
    setOpen(false);
    setQuery('');
    setResults([]);
    inputRef.current?.blur();
    navigate(record.route);
  };

  const seeAll = () => {
    const q = query.trim();
    setOpen(false);
    inputRef.current?.blur();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && results[active]) go(results[active]);
      else seeAll();
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showDropdown = open && (loading || query.trim().length > 0);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: 360, maxWidth: '50%' }}>
      <div
        className="hidden md:flex"
        style={{
          alignItems: 'center', gap: 8, padding: '4px 10px', height: 32,
          background: 'var(--bg-subtle)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <Icon name="search" size={13} />
        <input
          ref={inputRef}
          data-spotlight
          type="text"
          placeholder="Search entities, attributes, rules…"
          value={query}
          onFocus={() => { setOpen(true); ensureIndex(); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            color: 'var(--text)', fontSize: 'var(--fs-sm)',
          }}
        />
        <span
          className="mono"
          title="Press / to search"
          style={{
            fontSize: 11, color: 'var(--text-subtle)', padding: '0 6px',
            border: '1px solid var(--border)', borderRadius: 2, lineHeight: '16px',
          }}
        >
          /
        </span>
      </div>

      {showDropdown && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
            background: 'var(--bg-raised)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg, 0 8px 24px rgba(0,0,0,0.18))',
            zIndex: 50, overflow: 'hidden', maxHeight: 420,
          }}
        >
          {loading && results.length === 0 ? (
            <div style={{ padding: '10px 12px', color: 'var(--text-subtle)', fontSize: 'var(--fs-sm)' }}>
              Building index…
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: '10px 12px', color: 'var(--text-subtle)', fontSize: 'var(--fs-sm)' }}>
              No matches for “{query.trim()}”
            </div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.id}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); go(r); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '7px 12px', border: 'none', textAlign: 'left', cursor: 'pointer',
                  background: i === active ? 'var(--bg-hover, rgba(127,127,127,0.12))' : 'transparent',
                }}
              >
                <span
                  style={{
                    fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4,
                    color: '#fff', background: KIND_BADGE[r.kind], borderRadius: 3,
                    padding: '1px 5px', flexShrink: 0, minWidth: 62, textAlign: 'center',
                  }}
                >
                  {KIND_LABEL[r.kind]}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: 'var(--text)', fontSize: 'var(--fs-sm)', fontWeight: 500 }}>
                    {r.name}
                  </span>
                  {(r.entityName || r.service) && (
                    <span style={{ color: 'var(--text-subtle)', fontSize: 11, marginLeft: 6 }}>
                      {r.entityName ? `${r.entityName} · ` : ''}{r.service}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}

          <button
            onMouseDown={(e) => { e.preventDefault(); seeAll(); }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
              padding: '7px 12px', border: 'none', borderTop: '1px solid var(--border)',
              background: 'transparent', cursor: 'pointer',
              color: 'var(--text-subtle)', fontSize: 11,
            }}
          >
            <span>See all results</span>
            <span className="mono" style={{ fontSize: 10 }}>Enter ↵</span>
          </button>
        </div>
      )}
    </div>
  );
}
