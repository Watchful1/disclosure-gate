# disclosure-gate

A Devvit app that makes posters disclose AI usage before their post goes up.

When a post is submitted, the app removes it and leaves a stickied comment asking OP whether they used AI tools. Once OP replies to that comment, the post is approved and the comment is edited to quote the reply.

Only OP's first direct reply counts. Mods are exempt, and if another mod or bot removes the post in the meantime, it stays removed. OP has 30 days to reply; after that the post stays removed unless a mod approves it.

## Settings

- Remove posts until OP replies (default on). If off, the comment is still posted and updated but the post stays up. The default request text says the post is hidden, so edit that too.
- Sticky the disclosure comment (default on).
- Exempt approved users (default off).
- Exempt post flairs: one per line, case-insensitive.
- Request and confirmed comment text. Both can use `{{author}}`, `{{subreddit}}` and `{{post_link}}`. The confirmed comment can also use `{{reply}}` (OP's reply, quoted) and `{{reply_link}}`.

The default text asks about AI, but you can change it to ask anything.

## Development

```bash
npm install
npm test
npm run dev    # devvit playtest
```

[Privacy policy](docs/privacy-policy.md) · [Terms of service](docs/terms-of-service.md) · [BSD-3-Clause](LICENSE)
