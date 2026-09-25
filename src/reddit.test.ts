import { describe, expect, it } from 'vitest';
import { evaluateApprovalGate } from './reddit';

describe('evaluateApprovalGate', () => {
  const US = 'disclosure-gate';

  it('approves when the post is not removed at all', () => {
    const r = evaluateApprovalGate({
      removed: false,
      removedBy: undefined,
      appAccount: US,
      marker: false,
    });
    expect(r.approve).toBe(true);
  });

  it('approves when removedBy is our own app account', () => {
    const r = evaluateApprovalGate({
      removed: true,
      removedBy: 'disclosure-gate',
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
      appAccount: undefined,
      marker: false,
    });
    expect(r.approve).toBe(false);
  });
});
