/**
 * Granular auto-approve policy (#59)
 *
 * Replaces the single `ai-auto-approve` localStorage boolean with a
 * structured per-category object. The backend tags every tool-input-start
 * SSE event with a `category` (read | navigate | create | modify | delete)
 * so the panel only needs to look up the user's policy per category.
 *
 *   - 'auto'   → run immediately, no review
 *   - 'review' → mark the tool card pending until the user approves
 *   - 'off'    → reserved for the `delete` row in the Settings UI: we
 *                surface the row but disallow auto, so the option is
 *                shown as not-applicable. At runtime 'off' behaves
 *                exactly like 'review'. This is purely UI signalling.
 *
 * Design notes
 *
 * - Defaults are biased toward safety. Reads + navigation auto-approve;
 *   writes always pause. Delete can never be auto-approved.
 * - The decoder is deliberately permissive: anything malformed in
 *   localStorage falls back to defaults. We never want a bad parse to
 *   silently flip a user's `create` policy to `auto`.
 * - `getEffectivePolicy` clamps `delete` to a non-auto value so a hand-
 *   edited localStorage entry can't bypass the rule.
 */

export type AIToolCategory = 'read' | 'navigate' | 'create' | 'modify' | 'delete';
export type AIPolicyDecision = 'auto' | 'review' | 'off';

export type AIAutoApprovePolicy = Record<AIToolCategory, AIPolicyDecision>;

export const AI_AUTO_APPROVE_POLICY_KEY = 'ai-auto-approve-policy';
// Legacy single-toggle key. Read once on first migration so users who
// flipped it off keep their preference rather than getting silently
// re-enabled when this PR ships.
export const AI_AUTO_APPROVE_LEGACY_KEY = 'ai-auto-approve';

export const DEFAULT_AI_AUTO_APPROVE_POLICY: AIAutoApprovePolicy = {
  read: 'auto',
  navigate: 'auto',
  create: 'review',
  modify: 'review',
  delete: 'review',
};

const VALID_CATEGORIES: AIToolCategory[] = ['read', 'navigate', 'create', 'modify', 'delete'];
const VALID_DECISIONS: AIPolicyDecision[] = ['auto', 'review', 'off'];

function isCategory(value: unknown): value is AIToolCategory {
  return typeof value === 'string' && (VALID_CATEGORIES as string[]).includes(value);
}

function isDecision(value: unknown): value is AIPolicyDecision {
  return typeof value === 'string' && (VALID_DECISIONS as string[]).includes(value);
}

/**
 * Parse a JSON-encoded policy from localStorage. Anything missing or
 * malformed is filled with the default for that category. Returns a
 * fresh object — the caller can mutate its fields without polluting the
 * defaults.
 */
export function decodePolicy(raw: string | null | undefined): AIAutoApprovePolicy {
  const policy: AIAutoApprovePolicy = { ...DEFAULT_AI_AUTO_APPROVE_POLICY };
  if (!raw) return policy;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return policy;
  }
  if (!parsed || typeof parsed !== 'object') return policy;
  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    const value = (parsed as Record<string, unknown>)[key];
    if (isCategory(key) && isDecision(value)) {
      policy[key] = value;
    }
  }
  return policy;
}

/**
 * Read the current policy from localStorage, migrating the legacy
 * `ai-auto-approve` boolean on first run if no v2 entry exists yet.
 *
 *   legacy 'true'  / missing → default policy (writes still review)
 *   legacy 'false'           → all categories set to 'review'
 *
 * Returns the canonicalized policy (with `delete` clamped to a non-auto
 * decision).
 */
export function loadPolicy(storage: Storage = localStorage): AIAutoApprovePolicy {
  const raw = storage.getItem(AI_AUTO_APPROVE_POLICY_KEY);
  if (raw != null) {
    return getEffectivePolicy(decodePolicy(raw));
  }
  // First run after upgrade: honour the old single-toggle if it's set.
  const legacy = storage.getItem(AI_AUTO_APPROVE_LEGACY_KEY);
  if (legacy === 'false') {
    return getEffectivePolicy({
      read: 'review',
      navigate: 'review',
      create: 'review',
      modify: 'review',
      delete: 'review',
    });
  }
  return { ...DEFAULT_AI_AUTO_APPROVE_POLICY };
}

export function savePolicy(policy: AIAutoApprovePolicy, storage: Storage = localStorage): void {
  storage.setItem(AI_AUTO_APPROVE_POLICY_KEY, JSON.stringify(getEffectivePolicy(policy)));
}

/**
 * Clamp the policy so invariants always hold even if someone hand-edits
 * localStorage:
 *   - delete may never be 'auto' (no UI offers it; runtime falls back to review)
 */
export function getEffectivePolicy(policy: AIAutoApprovePolicy): AIAutoApprovePolicy {
  const next = { ...policy };
  if (next.delete === 'auto') next.delete = 'review';
  return next;
}

/**
 * Decide what to do with a tool whose category just arrived on the SSE
 * stream. 'auto' means run immediately (mark the card as terminal),
 * 'review' means hold the card in pending until the user clicks
 * Approve. The caller is the AIChatPanel reducer; the policy lookup
 * lives here so it stays in lockstep with the table in Settings.
 */
export function shouldAutoApprove(
  policy: AIAutoApprovePolicy,
  category: AIToolCategory | undefined | null,
): boolean {
  // No category emitted (older backend, edge cases): default to review
  // for safety. Never auto-approve a tool we can't classify.
  if (!category) return false;
  const effective = getEffectivePolicy(policy);
  return effective[category] === 'auto';
}
