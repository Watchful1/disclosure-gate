/**
 * Shared constants: setting defaults, placeholder names, Redis keys, TTLs and
 * limits. Kept here so the logic modules don't carry magic strings.
 */

export const LOG_PREFIX = '[disclosure-gate]';

export const DEFAULT_REQUEST_TEXT =
  '**AI disclosure required**\n\n' +
  'r/{{subreddit}} asks authors to disclose whether they used AI tools. ' +
  'u/{{author}}, please reply to this comment describing whether and how you used AI tools for this post, ' +
  "including for spelling or translation. If you didn't use any, just say so.\n\n" +
  'Your post is hidden until you reply here, and will be restored automatically once you do.';

export const DEFAULT_CONFIRMED_TEXT =
  '**AI disclosure from u/{{author}}:**\n\n' +
  '{{reply}}\n\n' +
  '^([original reply]({{reply_link}}))';

export const SETTING_DEFAULTS = {
  enabled: false,
  removePost: true,
  stickyComment: true,
  exemptApprovedUsers: false,
  exemptPostFlairs: '',
  requestText: DEFAULT_REQUEST_TEXT,
  confirmedText: DEFAULT_CONFIRMED_TEXT,
} as const;

/** Placeholders valid in every text setting. */
export const BASE_PLACEHOLDERS = ['author', 'subreddit', 'post_link'] as const;

/** Placeholders that only make sense once OP has replied. */
export const REPLY_PLACEHOLDERS = ['reply', 'reply_link'] as const;

export type Placeholder =
  | (typeof BASE_PLACEHOLDERS)[number]
  | (typeof REPLY_PLACEHOLDERS)[number];

/** Fixed note attached to the post removal (Reddit caps this at 100 chars). */
export const REMOVAL_NOTE = 'Awaiting OP reply to disclosure comment';

/** OP's reply is truncated to this many characters before quoting. */
export const REPLY_QUOTE_MAX_CHARS = 1500;

/**
 * Upper bound for a text setting. Reddit comments cap at 10,000 characters;
 * this leaves room for the quoted reply and expanded placeholders.
 */
export const TEXT_SETTING_MAX_CHARS = 9000;

export const REDIS_KEYS = {
  gate: (postId: string) => `gate:${postId}`,
  seen: (postId: string) => `seen:${postId}`,
  /** SETNX lock so only the first OP reply confirms, even if two race. */
  confirmClaim: (postId: string) => `confirm:${postId}`,
  modsCache: 'mods:cache',
} as const;

/** TTLs in seconds. */
export const TTL = {
  /** Also the effective deadline for OP to reply. */
  gate: 30 * 24 * 60 * 60,
  seen: 60 * 60,
  modsCache: 15 * 60,
} as const;
