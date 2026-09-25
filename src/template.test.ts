import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIRMED_TEXT,
  DEFAULT_REQUEST_TEXT,
  COMMENT_MAX_CHARS,
  REPLY_QUOTE_MAX_CHARS,
} from './config';
import {
  commentLink,
  postLink,
  quoteReply,
  render,
  validateTemplate,
} from './template';

describe('render', () => {
  it('replaces known placeholders', () => {
    expect(
      render('Hi u/{{author}} in r/{{subreddit}}', {
        author: 'alice',
        subreddit: 'test',
      })
    ).toBe('Hi u/alice in r/test');
  });

  it('tolerates whitespace and case inside braces', () => {
    expect(render('{{ Author }}', { author: 'alice' })).toBe('alice');
  });

  it('replaces every occurrence', () => {
    expect(render('{{author}} {{author}}', { author: 'a' })).toBe('a a');
  });

  it('leaves unknown or missing placeholders as written', () => {
    expect(render('{{nope}} {{reply}}', { author: 'a' })).toBe(
      '{{nope}} {{reply}}'
    );
  });

  it('does not re-expand placeholders inside substituted values', () => {
    expect(
      render('{{reply}} by {{author}}', {
        reply: '> I am {{author}}',
        author: 'alice',
      })
    ).toBe('> I am {{author}} by alice');
  });
});

describe('quoteReply', () => {
  it('block-quotes every line, keeping blank lines inside the quote', () => {
    expect(quoteReply('one\n\ntwo')).toBe('> one\n>\n> two');
  });

  it('trims surrounding whitespace', () => {
    expect(quoteReply('  \nhello\n  ')).toBe('> hello');
  });

  it('handles CRLF', () => {
    expect(quoteReply('a\r\nb')).toBe('> a\n> b');
  });

  it('quotes after a lone CR or Unicode line separator, so the quote cannot be escaped', () => {
    expect(quoteReply('ok\r# FAKE')).toBe('> ok\n> # FAKE');
    expect(quoteReply('ok\u2028# FAKE')).toBe('> ok\n> # FAKE');
    expect(quoteReply('ok\u2029# FAKE')).toBe('> ok\n> # FAKE');
  });

  it('truncates long replies with an ellipsis', () => {
    const q = quoteReply('x'.repeat(REPLY_QUOTE_MAX_CHARS + 50));
    expect(q).toBe('> ' + 'x'.repeat(REPLY_QUOTE_MAX_CHARS) + '…');
  });
});

describe('validateTemplate', () => {
  it('accepts the defaults', () => {
    expect(validateTemplate(DEFAULT_REQUEST_TEXT, 'request')).toBeNull();
    expect(validateTemplate(DEFAULT_CONFIRMED_TEXT, 'confirmed')).toBeNull();
  });

  it('rejects empty and whitespace-only text', () => {
    expect(validateTemplate('', 'request')).toMatch(/empty/);
    expect(validateTemplate('   \n', 'confirmed')).toMatch(/empty/);
    expect(validateTemplate(undefined, 'request')).toMatch(/empty/);
  });

  it('rejects text over the length limit', () => {
    expect(
      validateTemplate('x'.repeat(COMMENT_MAX_CHARS + 1), 'request')
    ).toMatch(/limit/);
  });

  it('rejects text that only goes over the limit once placeholders expand', () => {
    // Short as written, but each {{post_link}} expands to ~70 characters.
    const manyLinks = '{{post_link}} '.repeat(200);
    expect(manyLinks.length).toBeLessThan(COMMENT_MAX_CHARS);
    expect(validateTemplate(manyLinks, 'request')).toMatch(/limit/);
    // Four worst-case replies can't fit in one comment.
    expect(validateTemplate('{{reply}}\n'.repeat(4), 'confirmed')).toMatch(
      /limit/
    );
  });

  it('allows a long confirmed text that fits with a worst-case reply', () => {
    expect(
      validateTemplate('x'.repeat(5000) + '\n\n{{reply}}', 'confirmed')
    ).toBeNull();
  });

  it('rejects malformed placeholders', () => {
    expect(validateTemplate('{{post-link}}', 'request')).toContain(
      '{{post-link}}'
    );
    expect(validateTemplate('{{author1}}', 'request')).toContain('{{author1}}');
  });

  it('rejects unknown placeholders and names the valid ones', () => {
    const err = validateTemplate('Hi {{user}}', 'request');
    expect(err).toContain('{{user}}');
    expect(err).toContain('{{author}}');
  });

  it('rejects reply placeholders in the request text', () => {
    expect(validateTemplate('{{reply}}', 'request')).toMatch(/confirmed text/);
    expect(validateTemplate('{{reply_link}}', 'request')).toMatch(
      /confirmed text/
    );
  });

  it('allows reply placeholders in the confirmed text', () => {
    expect(
      validateTemplate('{{reply}} {{reply_link}}', 'confirmed')
    ).toBeNull();
  });

  it('allows text with no placeholders', () => {
    expect(validateTemplate('Please reply.', 'request')).toBeNull();
  });
});

describe('links', () => {
  it('builds post and comment links from prefixed ids', () => {
    expect(postLink('test', 't3_abc')).toBe(
      'https://www.reddit.com/r/test/comments/abc/'
    );
    expect(commentLink('test', 't3_abc', 't1_def')).toBe(
      'https://www.reddit.com/r/test/comments/abc/_/def/'
    );
  });
});
