import {
  BASE_PLACEHOLDERS,
  REPLY_PLACEHOLDERS,
  REPLY_QUOTE_MAX_CHARS,
  TEXT_SETTING_MAX_CHARS,
  type Placeholder,
} from './config';

/**
 * Pure placeholder rendering and validation for the comment text settings.
 * No Reddit or Redis access — everything here is unit-tested directly.
 */

export type TemplateValues = Partial<Record<Placeholder, string>>;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

/**
 * Replace every `{{name}}` in one pass. Because the replacement values are
 * never rescanned, placeholder-like text inside OP's reply stays literal.
 * Unknown or missing placeholders are left as written.
 */
export function render(template: string, values: TemplateValues): string {
  return template.replace(PLACEHOLDER_RE, (match, name: string) => {
    const value = values[name.toLowerCase() as Placeholder];
    return value ?? match;
  });
}

/**
 * Format OP's reply for `{{reply}}`: truncated, then block-quoted line by
 * line so it renders as a quote however it was formatted.
 */
export function quoteReply(body: string): string {
  let text = body.trim();
  if (text.length > REPLY_QUOTE_MAX_CHARS) {
    text = text.slice(0, REPLY_QUOTE_MAX_CHARS).trimEnd() + '…';
  }
  return text
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
}

export type TextKind = 'request' | 'confirmed';

/**
 * Validate a text setting. Returns an error message for the settings form,
 * or null if the value is fine.
 */
export function validateTemplate(
  value: string | undefined,
  kind: TextKind
): string | null {
  const text = value?.trim() ?? '';
  if (!text) return 'This text cannot be empty.';
  if (text.length > TEXT_SETTING_MAX_CHARS) {
    return `This text is ${text.length} characters; the limit is ${TEXT_SETTING_MAX_CHARS}.`;
  }

  const allowed = new Set<string>(
    kind === 'confirmed'
      ? [...BASE_PLACEHOLDERS, ...REPLY_PLACEHOLDERS]
      : BASE_PLACEHOLDERS
  );
  const unknown = new Set<string>();
  const replyOnly = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    const name = (m[1] ?? '').toLowerCase();
    if (allowed.has(name)) continue;
    if ((REPLY_PLACEHOLDERS as readonly string[]).includes(name)) {
      replyOnly.add(name);
    } else {
      unknown.add(name);
    }
  }
  if (unknown.size > 0) {
    const list = [...unknown].map((n) => `{{${n}}}`).join(', ');
    const valid = [...allowed].map((n) => `{{${n}}}`).join(', ');
    return `Unknown placeholder ${list}. Valid placeholders: ${valid}.`;
  }
  if (replyOnly.size > 0) {
    const list = [...replyOnly].map((n) => `{{${n}}}`).join(', ');
    return `${list} can only be used in the confirmed text, since OP hasn't replied yet.`;
  }
  return null;
}

/** reddit.com links for placeholders. Ids may be passed with or without prefix. */
export function postLink(subreddit: string, postId: string): string {
  const post = postId.replace(/^t3_/, '');
  return `https://www.reddit.com/r/${subreddit}/comments/${post}/`;
}

export function commentLink(
  subreddit: string,
  postId: string,
  commentId: string
): string {
  const comment = commentId.replace(/^t1_/, '');
  return `${postLink(subreddit, postId)}_/${comment}/`;
}
