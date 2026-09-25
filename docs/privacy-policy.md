# Privacy Policy: disclosure-gate

_Last updated: 2026-09-24_

This policy explains what data `disclosure-gate` accesses, how it uses that data, and what it stores. The app is operated by [Watchful1](https://github.com/Watchful1) and is open source at <https://github.com/Watchful1/disclosure-gate>.

## What data the app reads

The app receives the following information from Reddit through the Devvit platform, only for subreddits where it is installed:

- **New post events:** the post id, author username and id, and the post's flair text. These decide whether to ask for a disclosure and which author to address.
- **New comment events:** the comment id, parent id, author username and id, and comment body. They are used only to detect OP's reply to the app's own disclosure comment. All other comments are ignored after a single lookup.
- **The subreddit's moderator list**, cached for up to 15 minutes, to exempt moderators.
- **Whether a post author is an approved user**, only when a moderator turns on the approved-user exemption.

The app never reads private user data such as direct messages, voting history, subscriptions or browsing history.

## What data the app stores

State is kept in Devvit's per-installation Redis store, which Reddit isolates per subreddit:

| Key                | Contents                                                                                                                     | Purpose                               | TTL        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------- |
| `gate:<postId>`    | the app's comment id, whether OP has replied, whether the app removed the post, whether the comment is pinned, creation time | match OP's reply and approve the post | 30 days    |
| `confirm:<postId>` | marker                                                                                                                       | ensure only OP's first reply is used  | 30 days    |
| `seen:<postId>`    | marker                                                                                                                       | ignore duplicate event deliveries     | 1 hour     |
| `mods:cache`       | moderator usernames                                                                                                          | exempt moderators                     | 15 minutes |

No data is kept beyond these TTLs.

**OP's reply is copied into the app's comment.** If the confirmed comment text uses the `{{reply}}` placeholder (the default), OP's reply is quoted, publicly, in the app's comment on the post. That keeps the disclosure visible if OP later edits or deletes their reply. The copy is ordinary Reddit content and is removed when the post, or the app's comment, is deleted.

## What data the app sends off Reddit

None. The app makes no external HTTP requests.

## Data sharing

The app does not sell, rent, license or share any user data with anyone.

## Data deletion

- Uninstalling the app deletes its Redis store for that subreddit. Reddit does this automatically.
- Redis keys expire automatically, per the TTLs above.
- The app's comments are regular Reddit comments. Subreddit moderators can remove them, and they are deleted along with the post.

## Children's privacy

The app is not directed at, and is not intended to collect data from, anyone under the age of 13.

## Changes

Material changes to this policy will be announced via a commit to this repository.

## Contact

Open an issue at <https://github.com/Watchful1/disclosure-gate/issues> or message u/Watchful1 on Reddit.
