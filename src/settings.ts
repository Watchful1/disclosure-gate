import { settings } from '@devvit/web/server';
import { LOG_PREFIX, SETTING_DEFAULTS } from './config';

/** Fully populated settings snapshot; every field falls back to its default. */
export type ResolvedSettings = {
  removePost: boolean;
  stickyComment: boolean;
  exemptApprovedUsers: boolean;
  /** Raw multi-line list; parsed with parseFlairList(). */
  exemptPostFlairs: string;
  requestText: string;
  confirmedText: string;
};

/**
 * Long enough to absorb a burst of triggers reading settings together, short
 * enough that a mod's change applies within seconds.
 */
const CACHE_TTL_MS = 5_000;

let cached: { value: ResolvedSettings; expiresAt: number } | null = null;

function coerceBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function coerceString(raw: unknown, fallback: string): string {
  return typeof raw === 'string' ? raw : fallback;
}

/** Comment text must never be blank; an emptied field falls back to the default. */
function coerceText(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim() ? raw : fallback;
}

export function resolveSettings(
  raw: Record<string, unknown>
): ResolvedSettings {
  const d = SETTING_DEFAULTS;
  return {
    removePost: coerceBoolean(raw.removePost, d.removePost),
    stickyComment: coerceBoolean(raw.stickyComment, d.stickyComment),
    exemptApprovedUsers: coerceBoolean(
      raw.exemptApprovedUsers,
      d.exemptApprovedUsers
    ),
    exemptPostFlairs: coerceString(raw.exemptPostFlairs, d.exemptPostFlairs),
    requestText: coerceText(raw.requestText, d.requestText),
    confirmedText: coerceText(raw.confirmedText, d.confirmedText),
  };
}

export async function getSettings(): Promise<ResolvedSettings> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  let raw: Record<string, unknown>;
  try {
    raw = (await settings.getAll<Record<string, unknown>>()) ?? {};
  } catch (err) {
    console.warn(`${LOG_PREFIX} settings.getAll failed; using defaults`, err);
    raw = {};
  }
  const value = resolveSettings(raw);
  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}
