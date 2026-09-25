import { describe, expect, it } from 'vitest';
import { evaluateApprovalGate, isAlreadyRemoved } from './reddit';

describe('evaluateApprovalGate', () => {
  const US = 'disclosure-gate';

  it('approves when the post is not removed at all', () => {
    const r = evaluateApprovalGate({
      removed: false,
      removedBy: undefined,
      removedByCategory: undefined,
      spam: false,
      appAccount: US,
      marker: false,
    });
    expect(r.approve).toBe(true);
  });

  it('approves when removedBy is our own app account', () => {
    const r = evaluateApprovalGate({
      removed: true,
      removedBy: 'disclosure-gate',
      removedByCategory: undefined,
      spam: false,
      appAccount: US,
      marker: true,
    });
    expect(r.approve).toBe(true);
    expect(r.removedBySomeoneElse).toBe(false);
  });

  it('matches removedBy against the app account case-insensitively', () => {
    const r = evaluateApprovalGate({
      removed: true,
      removedBy: 'Disclosure-Gate',
      removedByCategory: undefined,
      spam: false,
      appAccount: US,
      marker: false,
    });
    expect(r.approve).toBe(true);
  });

  // Regression (from expdevsmodbot): our gate removed the post (setting the marker),
  // then u/other-bot removed it, then OP replied to our sticky. The
  // stale marker made the old check approve and undo the other bot's removal.
  it('does NOT approve when another bot removed it, even with our stale marker', () => {
    const r = evaluateApprovalGate({
      removed: true,
      removedBy: 'other-bot',
      removedByCategory: undefined,
      spam: false,
      appAccount: US,
      marker: true,
    });
    expect(r.approve).toBe(false);
    expect(r.removedBySomeoneElse).toBe(true);
    expect(r.reason).toContain('other-bot');
  });

  it('does NOT approve when a human mod removed it, even with our stale marker', () => {
    const r = evaluateApprovalGate({
      removed: true,
      removedBy: 'some-mod',
      removedByCategory: undefined,
      spam: false,
      appAccount: US,
      marker: true,
    });
    expect(r.approve).toBe(false);
    expect(r.removedBySomeoneElse).toBe(true);
  });

  it('falls back to the marker when removedBy is unavailable (marker present)', () => {
    const r = evaluateApprovalGate({
      removed: true,
      removedBy: undefined,
      removedByCategory: undefined,
      spam: false,
      appAccount: US,
      marker: true,
    });
    expect(r.approve).toBe(true);
    expect(r.removedBySomeoneElse).toBe(false);
  });

  it('does NOT approve when removedBy is unavailable and no marker', () => {
    const r = evaluateApprovalGate({
      removed: true,
      removedBy: undefined,
      removedByCategory: undefined,
      spam: false,
      appAccount: US,
      marker: false,
    });
    expect(r.approve).toBe(false);
    expect(r.removedBySomeoneElse).toBe(false);
  });

  it('falls back to the marker when the app account is unknown', () => {
    const r = evaluateApprovalGate({
      removed: true,
      removedBy: 'other-bot',
      removedByCategory: undefined,
      spam: false,
      appAccount: undefined,
      marker: false,
    });
    expect(r.approve).toBe(false);
  });
});

describe('evaluateApprovalGate fallback when removedBy is missing', () => {
  const base = {
    removed: true,
    removedBy: undefined,
    appAccount: 'disclosure-gate',
    marker: true,
  };

  it('approves on the marker when the category is a mod removal', () => {
    const r = evaluateApprovalGate({
      ...base,
      removedByCategory: 'moderator',
      spam: false,
    });
    expect(r.approve).toBe(true);
  });

  it.each(['automod_filtered', 'reddit', 'anti_evil_ops', 'content_takedown'])(
    'refuses when the category is %s, even with our marker',
    (removedByCategory) => {
      const r = evaluateApprovalGate({
        ...base,
        removedByCategory,
        spam: false,
      });
      expect(r.approve).toBe(false);
      expect(r.reason).toContain(removedByCategory);
    }
  );

  it('refuses when the post is marked as spam, even with our marker', () => {
    const r = evaluateApprovalGate({
      ...base,
      removedByCategory: undefined,
      spam: true,
    });
    expect(r.approve).toBe(false);
  });

  it('still trusts removedBy over category and spam when present', () => {
    const r = evaluateApprovalGate({
      ...base,
      removedBy: 'disclosure-gate',
      removedByCategory: 'moderator',
      spam: true,
    });
    expect(r.approve).toBe(true);
  });
});

describe('isAlreadyRemoved', () => {
  const clean = { removed: false, spam: false, removedByCategory: undefined };

  it('is false for a live post', () => {
    expect(isAlreadyRemoved(clean)).toBe(false);
  });

  it('is true when removed, spam, or given any removal category', () => {
    expect(isAlreadyRemoved({ ...clean, removed: true })).toBe(true);
    expect(isAlreadyRemoved({ ...clean, spam: true })).toBe(true);
    expect(
      isAlreadyRemoved({ ...clean, removedByCategory: 'automod_filtered' })
    ).toBe(true);
  });
});
