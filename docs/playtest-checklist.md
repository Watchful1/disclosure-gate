# Playtest checklist

`npx devvit playtest <dev-subreddit>` installs a playtest build on a test
subreddit and streams its logs. Moderators are exempt, so post from a
**non-mod alt account** (called "alt" below). Every app log line starts with
`[disclosure-gate]`.

## Setup

- [ ] Settings page shows three groups: General, Exemptions, Comment text.
- [ ] Defaults: Remove on, Sticky on, Exempt approved users off,
      flair list empty, AI disclosure texts filled in.

## Settings validation

- [ ] Request text containing `{{reply}}` → save rejected, error mentions the confirmed text.
- [ ] Request text containing `{{foo}}` → rejected, error lists the valid placeholders.
- [ ] Empty confirmed text → rejected.
- [ ] Request text containing `{{post-link}}` (hyphen) → rejected as unknown.
- [ ] Confirmed text with `{{reply}}` four times → rejected as over the length limit.
- [ ] Restore the defaults → save succeeds.

## Platform questions (answer these first)

The triggers are `onPostCreate` / `onCommentCreate`, which fire after Reddit's safety delay.

- [ ] How long after submitting does the post get removed? (This is the window it's visible.)
- [ ] In the `confirmed` log, is `reason` "current removal is ours (removedBy matches app account)"? If it says the removal belongs to someone else, `removedBy` isn't the app's name and nothing will ever be approved.
- [ ] Post and comment ids in the logs have `t3_` / `t1_` prefixes.
- [ ] No `addRemovalNote failed` warnings (it's sent with an empty `reasonId`).
- [ ] A crosspost into the sub gets gated like a normal post.

## Core flow (Remove on, Sticky on)

- [ ] Alt submits a post → the post is removed; the app's comment is distinguished, stickied and rendered (`u/<alt>`, `r/<sub>`). Log: `gated ... removed=true sticky=true`.
- [ ] The removal shows the mod note "Awaiting OP reply to disclosure comment" in the mod log / queue.
- [ ] A different user replies to the app's comment → nothing changes. Log: `ignore-reply ... reason="commenter is not OP"`.
- [ ] Alt makes a top-level comment → nothing changes (no log line; it isn't a reply to the request).
- [ ] Alt replies to the app's comment → the comment is edited to the confirmed text quoting the reply, and the post is approved. Log: `confirmed ... approved=true`.
- [ ] Alt replies to the app's comment again → nothing changes (the record is already confirmed, so the reply is dropped without a log line).
- [ ] A reply containing `{{author}}` is quoted literally, not expanded.
- [ ] A reply longer than 1,500 characters is truncated with `…`.

## Someone else's removal is respected

- [ ] Alt posts → gated. A mod removes the post manually. Alt replies → the comment is edited, but the post **stays removed**. Log: `approved=false reason="current removal belongs to u/<mod>"`.
- [ ] Add an AutoMod rule that filters the alt's posts. Alt posts → either no trigger fires at all, or the comment is posted but the app doesn't remove the post again (log: `gated ... removed=false alreadyRemoved=true`). Note which. Alt replies → the post **stays in the queue**. Log: `approved=false reason="app did not remove the post"`.
- [ ] Add an AutoMod rule that removes comments containing a test word. Alt replies to the app's comment with that word → nothing is quoted. Log: `ignore-reply ... reason="reply is removed or spam"`. Alt replies again without it → confirmed as normal.

## Toggles

- [ ] Remove **off**: alt posts → the post stays visible and the comment is posted. Alt replies → the comment is edited. Log: `approved=false reason="app did not remove the post"`.
- [ ] Sticky **off**: the comment is posted and distinguished, but not pinned.

## Exemptions

- [ ] A mod posts → skipped (`author exempt (moderator)`).
- [ ] Add a post flair, e.g. `Meta`, to the exempt list; alt posts with that flair → skipped (`post-flair`). Try it with different capitalisation too.
- [ ] Make alt an approved user with the toggle off → gated. Turn the toggle on → skipped (`approved-user`).

## Robustness

- [ ] `devvit logs <sub>` shows no uncaught errors for any of the above.
