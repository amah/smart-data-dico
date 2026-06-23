/**
 * useHighlightOnArrival (#191 §B) — flash the element an AI mutation just
 * changed after the assistant panel navigates to its destination.
 *
 * Transport: the AIChatPanel appends `?highlight=<encoded element key>` to
 * the clean navigate path. The destination page reads that param and calls
 * this hook, which:
 *   1. locates the row stamped with `data-ttrowkey="<key>"` inside the
 *      given scroll container (the same attribute TreeTable stamps for its
 *      sticky-path tracking — see TreeTable.tsx),
 *   2. scrolls it into view and toggles the `.sdd-flash` class (a brief
 *      ring/background pulse defined in tokens.css, modeled on the
 *      Cytoscape `.highlighted` pattern),
 *   3. strips the `?highlight=` param via history.replace so a refresh or
 *      back-navigation doesn't re-flash.
 *
 * The hook owns no UI — pass it the scroll container ref and the rows
 * dependency so it re-runs once the target row has actually rendered.
 */

import { useEffect, type RefObject } from 'react';
import { useSearchParams } from 'react-router-dom';

const FLASH_CLASS = 'sdd-flash';
// How long to keep polling for the target row to mount before giving up and
// dropping the `?highlight=` param. Covers async data loads on the destination.
const MAX_WAIT_MS = 2500;

export function useHighlightOnArrival(
  scrollRef: RefObject<HTMLElement | null>,
  /** Bump this when the rows that could contain the target finish rendering. */
  ready: unknown,
): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const highlight = searchParams.get('highlight');

  useEffect(() => {
    if (!highlight) return;

    // CSS.escape guards keys with quotes/special chars; fall back to a plain
    // attribute-equals selector in environments that lack it (e.g. jsdom).
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(highlight)
      : highlight.replace(/["\\]/g, '\\$&');

    const strip = () => {
      // Replace history (don't push) so a refresh / back doesn't re-flash.
      const next = new URLSearchParams(searchParams);
      next.delete('highlight');
      setSearchParams(next, { replace: true });
    };

    // The destination row often mounts a few commits AFTER this effect first
    // runs — the container and/or the row render once their async data lands,
    // and that render isn't tied to our `ready` dep. So poll across animation
    // frames until the row appears (bounded), rather than firing once and
    // giving up (which left the flash silently not happening on EntityDetail).
    let raf = 0;
    const deadline = Date.now() + MAX_WAIT_MS;

    const attempt = () => {
      const target = scrollRef.current?.querySelector<HTMLElement>(
        `[data-ttrowkey="${escaped}"]`,
      );
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        // Restart the animation cleanly even if a stale class lingered.
        target.classList.remove(FLASH_CLASS);
        void target.offsetWidth; // force reflow so the keyframe re-triggers
        target.classList.add(FLASH_CLASS);
        // Remove via animationend (NOT a timer): a timer is cancelled by this
        // effect's cleanup when strip() flips `highlight` to null and re-runs
        // the effect, so the class would otherwise linger forever.
        target.addEventListener(
          'animationend',
          () => target.classList.remove(FLASH_CLASS),
          { once: true },
        );
        strip();
        return;
      }
      if (Date.now() < deadline) {
        raf = requestAnimationFrame(attempt);
      } else {
        // Row never showed (e.g. deleted, or wrong page) — drop the param so a
        // later render doesn't keep retrying.
        strip();
      }
    };
    raf = requestAnimationFrame(attempt);

    return () => { if (raf) cancelAnimationFrame(raf); };
    // `ready` is intentionally in deps so a data-load re-render restarts the
    // poll promptly. We key off `highlight`; searchParams/setSearchParams are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight, ready]);
}
