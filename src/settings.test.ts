import { describe, expect, it } from 'vitest';
import devvitConfig from '../devvit.json';
import { SETTING_DEFAULTS } from './config';
import { resolveSettings } from './settings';

describe('resolveSettings', () => {
  it('falls back to defaults when raw is empty', () => {
    expect(resolveSettings({})).toEqual(SETTING_DEFAULTS);
  });

  it('passes through valid values', () => {
    const r = resolveSettings({
      removePost: false,
      stickyComment: false,
      exemptApprovedUsers: true,
      exemptPostFlairs: 'Meta',
      requestText: 'Reply please',
      confirmedText: 'Thanks {{reply}}',
    });
    expect(r).toEqual({
      removePost: false,
      stickyComment: false,
      exemptApprovedUsers: true,
      exemptPostFlairs: 'Meta',
      requestText: 'Reply please',
      confirmedText: 'Thanks {{reply}}',
    });
  });

  it('rejects wrong types', () => {
    const r = resolveSettings({
      removePost: 1,
      exemptPostFlairs: 5,
    });
    expect(r.removePost).toBe(SETTING_DEFAULTS.removePost);
    expect(r.exemptPostFlairs).toBe(SETTING_DEFAULTS.exemptPostFlairs);
  });

  it('falls back to default text when a text setting is blank', () => {
    const r = resolveSettings({ requestText: '  ', confirmedText: '' });
    expect(r.requestText).toBe(SETTING_DEFAULTS.requestText);
    expect(r.confirmedText).toBe(SETTING_DEFAULTS.confirmedText);
  });
});

describe('devvit.json', () => {
  // Settings live in two places: the form defaults (devvit.json) and the
  // runtime fallbacks (config.ts). Keep them in sync.
  it('declares the same defaults as SETTING_DEFAULTS', () => {
    const fields: Record<string, { defaultValue?: unknown }> = {};
    for (const group of Object.values(devvitConfig.settings.subreddit)) {
      Object.assign(fields, group.fields);
    }
    const declared = Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, v.defaultValue])
    );
    expect(declared).toEqual(SETTING_DEFAULTS);
  });
});
