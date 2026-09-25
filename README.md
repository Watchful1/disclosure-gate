# disclosure-gate

**Ask every poster to disclose their AI usage before their post goes live.**

disclosure-gate is a Reddit moderation app for subreddits that want authors to say whether and how they used AI tools. When someone submits a post, the app removes it and pins a comment asking OP to reply with an AI disclosure. As soon as OP replies, the app approves the post and replaces its comment with OP's disclosure, quoted, so readers see it at the top of the thread.

All of the comment text is configurable, so the same flow works for any "OP must answer this before the post goes live" rule.

## How it works

1. **A new post is submitted.** Unless the author is exempt, the app:
   - removes the post (optional), with a mod note: _Awaiting OP reply to disclosure comment_
   - posts the **request comment** as the app account, distinguished and stickied (optional).
2. **OP replies directly to that comment.** The app:
   - edits its comment to the **confirmed comment**, which by default quotes OP's reply
   - approves the post, if the app was the one that removed it.
3. **Nothing else counts.** Replies from other users, OP comments elsewhere in the thread, and further OP replies after the first are ignored.

The app never undoes another moderator's decision. If a mod, AutoMod or another bot has removed the post since the app did, OP's reply still updates the comment, but the post stays removed.

OP has 30 days to reply. After that the app stops tracking the post.

## Settings

Configure the app from your subreddit's app settings page: `https://developers.reddit.com/r/<subreddit>/apps/disclosure-gate`.

### General

| Setting                       | Default | Description                                                                             |
| ----------------------------- | ------- | --------------------------------------------------------------------------------------- |
| Enabled                       | off     | Turns the gate on for new posts. Existing posts are never affected.                     |
| Remove posts until OP replies | on      | If off, the comment is still posted and updated, but the post stays visible throughout. |
| Sticky the disclosure comment | on      | Distinguishes and pins the app's comment to the top of the post.                        |

### Exemptions

Moderators and the app account are always exempt.

| Setting               | Default   | Description                                                                                               |
| --------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| Exempt approved users | off       | Skip posts by the subreddit's approved users.                                                             |
| Exempt post flairs    | _(empty)_ | One post flair per line. Posts with a matching flair are skipped. Matching is case-insensitive and exact. |

### Comment text

Both texts are Reddit markdown and can use placeholders:

| Placeholder      | Request | Confirmed | Value                                                      |
| ---------------- | :-----: | :-------: | ---------------------------------------------------------- |
| `{{author}}`     |    ✓    |     ✓     | OP's username (without `u/`)                               |
| `{{subreddit}}`  |    ✓    |     ✓     | Subreddit name (without `r/`)                              |
| `{{post_link}}`  |    ✓    |     ✓     | Link to the post                                           |
| `{{reply}}`      |         |     ✓     | OP's reply as a block quote, truncated to 1,500 characters |
| `{{reply_link}}` |         |     ✓     | Link to OP's reply                                         |

Quoting `{{reply}}` in the confirmed text keeps the disclosure on the post even if OP later edits or deletes their reply.

Text is checked when you save the settings. Empty text, unknown placeholders and reply placeholders in the request text are rejected, with an error that explains why.

**Default request comment**

```
**AI disclosure required**

r/{{subreddit}} asks authors to disclose whether they used AI tools. u/{{author}}, please reply to this comment describing whether and how you used AI tools for this post, including for spelling or translation. If you didn't use any, just say so.

Your post is hidden until you reply here, and will be restored automatically once you do.
```

**Default confirmed comment**

```
**AI disclosure from u/{{author}}:**

{{reply}}

^([original reply]({{reply_link}}))
```

If you turn off **Remove posts until OP replies**, edit the request text too, because the default says the post is hidden.

## Permissions

The app only uses the Reddit API. It makes no external HTTP requests. It needs to:

- read new posts and comments
- remove and approve posts
- post, distinguish and edit its own comments
- read the moderator and approved-user lists.

## Privacy and terms

- [Privacy policy](docs/privacy-policy.md)
- [Terms of service](docs/terms-of-service.md)

## Development

Built with [Devvit Web](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_overview), [Hono](https://hono.dev/), TypeScript and Vitest.

```bash
npm install
npm test            # unit tests
npm run type-check
npm run lint
npm run dev         # devvit playtest
```

```
src/
├── index.ts          Hono bootstrap
├── config.ts         defaults, placeholder names, Redis keys, limits
├── settings.ts       typed settings with fallbacks
├── template.ts       placeholder rendering + validation   (pure)
├── gate.ts           post / reply decisions, flair parsing (pure)
├── exemptions.ts     moderator cache, approved-user lookup
├── state.ts          per-post Redis record
├── reddit.ts         retries, distinguish, approval safety check
└── routes/
    ├── triggers.ts   PostSubmit, CommentSubmit, AppInstall
    └── settings.ts   settings validation endpoints
```

See [docs/playtest-checklist.md](docs/playtest-checklist.md) for the manual test pass.

## License

[BSD-3-Clause](LICENSE)
