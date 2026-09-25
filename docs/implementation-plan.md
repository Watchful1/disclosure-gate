# disclosure-gate — implementation plan

A Devvit app that asks post authors to disclose AI usage. On every new post it
(optionally) removes the post and comments asking OP to reply; when OP replies
directly to that comment, the comment is edited to a "confirmed" text quoting
the reply and the post is approved.

Extracted from the AI disclosure gate in the private `expdevsmodbot` app, made
generic and configurable. The app/repo name is generic; the README, app
description and default setting text frame it as an AI disclosure app.

## Decisions

- No shadow mode and no on/off toggle: installed means active; uninstall to stop.
- Removing the post and stickying the comment are both toggles.
- Only a **direct reply by OP** to the bot comment counts. No minimum length,
  no "any top-level comment" option. First reply wins.
- No time limit, no scheduler. The Redis record lives 30 days; that is the
  effective limit.
- The removal note text is fixed, not a setting.
- Exemptions: mods + app account (always), approved users (toggle), post flair
  text list (case-insensitive exact match). No "only apply to" filters.
- No mod menu items.
- No Discord / HTTP permission. Only `reddit: true`.
- Comment text is fully configurable with placeholders.
- r/ExperiencedDevs keeps using expdevsmodbot; no migration.

## Settings (devvit.json, grouped)

| Group      | Key                   | Type      | Default               |
| ---------- | --------------------- | --------- | --------------------- |
| General    | `removePost`          | boolean   | `true`                |
| General    | `stickyComment`       | boolean   | `true`                |
| Exemptions | `exemptApprovedUsers` | boolean   | `false`               |
| Exemptions | `exemptPostFlairs`    | paragraph | empty (one per line)  |
| Text       | `requestText`         | paragraph | AI disclosure request |
| Text       | `confirmedText`       | paragraph | quotes OP's reply     |

Placeholders: `{{author}}`, `{{subreddit}}`, `{{post_link}}`, and in
`confirmedText` only: `{{reply}}` (block-quoted, truncated ~1500 chars),
`{{reply_link}}`. Rendered in a single pass so text inside OP's reply is
never re-expanded.

Both text settings have a `validationEndpoint` rejecting: empty text, unknown
placeholders, reply placeholders in `requestText`, and text over 9000 chars.
An empty/whitespace value at runtime falls back to the default.

## State

- `gate:<postId>` → `{ commentId, status: 'pending' | 'confirmed', removedByUs,
distinguished, createdAt }`, TTL 30 days. Serves as: the cheap "is this a
  reply to our pending comment" check (no API call), first-reply-wins
  idempotency, and the removed-by-us fallback for the approval gate.
- `seen:<postId>`, 1h SETNX — duplicate-delivery guard; released if the flow throws so a redelivery can retry.
- `confirm:<postId>`, 5 min SETNX — stops two simultaneous OP replies both confirming; released on failure.
- `mods:cache`, 15 min — moderator list.

## Flows

Triggers are `onPostCreate` / `onCommentCreate`, which fire after Reddit's
safety delay, so AutoMod and the spam filter have already acted. (Changed
from PostSubmit / CommentSubmit after code review.)

**PostCreate**

1. Duplicate delivery / exempt → skip. Exemption order: mod,
   post flair, approved user (API call only when toggle on).
2. `removePost` on → if the post is already removed, spam, or has a removal
   category, leave it alone (not ours). Otherwise `post.remove()` and
   `addRemovalNote` with the fixed note (failure logged, not fatal).
3. Submit rendered `requestText` as the app. Not retried, to avoid a
   duplicate comment; on failure, re-approve the post.
4. Write the record immediately, before distinguishing, so a fast OP reply
   finds it. If the write fails, re-approve and delete the comment.
5. Distinguish+sticky if enabled, then record that it landed.

**CommentCreate**

1. Skip the app's own comments.
2. Load `gate:<postId>`; continue only if `pending` and
   `parentId === commentId`.
3. Confirm the commenter is OP (`post.authorId`).
4. Re-read the reply; skip it if removed or spam (no lock taken, so OP can
   reply again).
5. Take the 5-minute confirm lock.
6. Edit the bot comment to rendered `confirmedText`; re-attempt the sticky if
   it never landed.
7. If we removed the post, approve it via the approval gate — never undo a
   removal owned by another mod/bot (`removedBy` check; the marker fallback
   only applies when not spam and the category is a mod removal).
8. Mark the record `confirmed` only if the edit succeeded. On any failure the
   record stays `pending` and the lock is released, so OP's next reply retries.

**AppInstall** — warm the mod cache.

## Layout

```
devvit.json
src/
├── index.ts          Hono bootstrap
├── config.ts         defaults, placeholder names, Redis keys, TTLs, limits
├── settings.ts       typed getSettings() with coercion + 5s cache
├── template.ts       render + validate            (pure)
├── gate.ts           decidePost / decideReply     (pure)
├── exemptions.ts     mods cache, approved users, flair parsing
├── state.ts          Redis record helpers
├── reddit.ts         withGrpcRetry, distinguish, approval gate
└── routes/
    ├── triggers.ts   on-app-install, on-post-submit, on-comment-submit
    └── settings.ts   validation endpoints
docs/ privacy-policy.md, terms-of-service.md, playtest-checklist.md
README.md, LICENSE
```

Reused from expdevsmodbot: `withGrpcRetry`, distinguish-with-retry,
`evaluateApprovalGate` / `approvePostById` (+ tests), moderator cache,
settings coercion pattern.

## Tests (Vitest)

- template: rendering, reply quoting/truncation, no re-expansion, validation.
- gate: post decisions (exempt, remove/sticky toggles) and reply
  decisions (OP vs not, wrong parent, confirmed, missing record).
- exemptions: flair list parsing and matching.
- settings: coercion and fallbacks.
- reddit: approval gate cases.

## Steps

1. ✅ Scaffold folder, toolchain, `git init`.
2. ✅ Pure modules + tests.
3. ✅ Redis / Reddit layer.
4. ✅ Routes + devvit.json.
5. ✅ README, privacy policy, terms of service, LICENSE, playtest checklist.
6. ✅ type-check, lint, test, build all green; commit.
7. **Owner:** playtest on a dev subreddit using a non-mod alt account
   (mod posts are exempt) — see docs/playtest-checklist.md.
8. **Owner:** `gh repo create Watchful1/disclosure-gate --public --source . --push`
9. **Owner:** `npm run deploy` (upload), then `npm run launch` (publish for review).
