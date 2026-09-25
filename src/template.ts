import {
  BASE_PLACEHOLDERS,
  COMMENT_MAX_CHARS,
  REPLY_PLACEHOLDERS,
  REPLY_QUOTE_MAX_CHARS,
  type Placeholder,
} from './config';

/**
 * Pure placeholder rendering and validation for the comment text settings.
 * No Reddit or Redis access — everything here is unit-tested directly.
 */

export type TemplateValues = Partial<Record<Placeholder, string>>;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

/** Anything brace-delimited, including malformed names like {{post-link}}. */
const ANY_PLACEHOLDER_RE = /\{\{([^{}]*)\}\}/g;

/** Every line break Reddit's markdown might honour, so a quote can't be escaped. */
const LINE_BREAK_RE = /\r\n|\r|\n|\u2028|\u2029/;

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
    .split(LINE_BREAK_RE)
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
}

/**
 * The longest each placeholder can expand to, used to check a template can't
 * render past Reddit's comment limit. Usernames and subreddit names cap at
 * 20 and 21 characters; the reply is the worst case of quoteReply(), where
 * every other character is a line break and each line gains a "> " prefix.
 */
const WORST_CASE_VALUES: Required<TemplateValues> = {
  author: 'x'.repeat(20),
  subreddit: 'x'.repeat(21),
  post_link: postLink('x'.repeat(21), 't3_' + 'x'.repeat(10)),
  reply_link: commentLink(
    'x'.repeat(21),
    't3_' + 'x'.repeat(10),
    't1_' + 'x'.repeat(10)
  ),
  reply: quoteReply('x\n'.repeat(REPLY_QUOTE_MAX_CHARS / 2) + 'x'),
};

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

  const allowed = new Set<string>(
    kind === 'confirmed'
      ? [...BASE_PLACEHOLDERS, ...REPLY_PLACEHOLDERS]
      : BASE_PLACEHOLDERS
  );
  const unknown = new Set<string>();
  const replyOnly = new Set<string>();
  for (const m of text.matchAll(ANY_PLACEHOLDER_RE)) {
    const name = (m[1] ?? '').trim().toLowerCase();
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

  const worst = render(text, WORST_CASE_VALUES).length;
  if (worst > COMMENT_MAX_CHARS) {
    return (
      `With placeholders filled in, this text can reach ${worst} characters, ` +
      `over Reddit's ${COMMENT_MAX_CHARS} limit. Shorten it or use fewer placeholders.`
    );
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
