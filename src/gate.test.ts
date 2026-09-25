import { describe, expect, it } from 'vitest';
import {
  decidePost,
  decideReply,
  isExemptFlair,
  parseFlairList,
  type GateRecord,
} from './gate';

describe('decidePost', () => {
  const base = {
    removePost: true,
    stickyComment: true,
    exemption: null,
    alreadyGated: false,
  };

  it('gates with the configured toggles', () => {
    expect(decidePost(base)).toEqual({
      kind: 'gate',
      remove: true,
      sticky: true,
    });
    expect(
      decidePost({ ...base, removePost: false, stickyComment: false })
    ).toEqual({ kind: 'gate', remove: false, sticky: false });
  });

  it.each(['moderator', 'post-flair', 'approved-user'] as const)(
    'skips exempt author (%s)',
    (exemption) => {
      const d = decidePost({ ...base, exemption });
      expect(d.kind).toBe('skip');
      if (d.kind === 'skip') expect(d.reason).toContain(exemption);
    }
  );

  it('skips a post that already has a record', () => {
    expect(decidePost({ ...base, alreadyGated: true })).toMatchObject({
      kind: 'skip',
    });
  });
});

describe('decideReply', () => {
  const record: GateRecord = {
    commentId: 't1_bot',
    status: 'pending',
    removedByUs: true,
    distinguished: true,
    createdAt: 0,
  };

  it('confirms and approves an OP reply when we removed the post', () => {
    expect(decideReply({ record, parentId: 't1_bot', isOp: true })).toEqual({
      kind: 'confirm',
      approve: true,
    });
  });

  it('confirms without approving when we did not remove the post', () => {
    expect(
      decideReply({
        record: { ...record, removedByUs: false },
        parentId: 't1_bot',
        isOp: true,
      })
    ).toEqual({ kind: 'confirm', approve: false });
  });

  it('passes the pre-check when OP status is not yet known', () => {
    expect(
      decideReply({ record, parentId: 't1_bot', isOp: undefined }).kind
    ).toBe('confirm');
  });

  it('ignores non-OP replies', () => {
    expect(
      decideReply({ record, parentId: 't1_bot', isOp: false })
    ).toMatchObject({
      kind: 'ignore',
      reason: 'commenter is not OP',
    });
  });

  it('ignores replies to other comments or the post itself', () => {
    expect(decideReply({ record, parentId: 't1_other', isOp: true }).kind).toBe(
      'ignore'
    );
    expect(decideReply({ record, parentId: 't3_post', isOp: true }).kind).toBe(
      'ignore'
    );
  });

  it('ignores replies once confirmed (first reply wins)', () => {
    expect(
      decideReply({
        record: { ...record, status: 'confirmed' },
        parentId: 't1_bot',
        isOp: true,
      })
    ).toMatchObject({ kind: 'ignore', reason: 'already confirmed' });
  });

  it('ignores when there is no record (not gated, or expired)', () => {
    expect(
      decideReply({ record: null, parentId: 't1_bot', isOp: true }).kind
    ).toBe('ignore');
  });
});

describe('exempt flairs', () => {
  it('parses one flair per line, trimmed and lowercased, skipping blanks', () => {
    expect([...parseFlairList(' Meta \n\nAnnouncement\r\n  ')]).toEqual([
      'meta',
      'announcement',
    ]);
  });

  it('matches case-insensitively and exactly', () => {
    const list = parseFlairList('Meta');
    expect(isExemptFlair('META', list)).toBe(true);
    expect(isExemptFlair(' meta ', list)).toBe(true);
    expect(isExemptFlair('Meta discussion', list)).toBe(false);
  });

  it('never matches a missing flair or an empty list', () => {
    expect(isExemptFlair(undefined, parseFlairList('Meta'))).toBe(false);
    expect(isExemptFlair('', parseFlairList(''))).toBe(false);
    expect(isExemptFlair('Meta', parseFlairList(''))).toBe(false);
  });
});
