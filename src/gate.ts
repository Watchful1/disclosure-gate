/**
 * Pure decisions for the two triggers. All Reddit/Redis lookups happen in the
 * route handlers; the results are passed in here so the rules are testable.
 */

export type GateStatus = 'pending' | 'confirmed';

export type GateRecord = {
  /** The app's request comment on the post. */
  commentId: string;
  status: GateStatus;
  /** True if the app removed the post; only then does it approve it. */
  removedByUs: boolean;
  /** Whether distinguish+sticky actually landed. */
  distinguished: boolean;
  createdAt: number;
};

export type Exemption = 'moderator' | 'post-flair' | 'approved-user';

export type PostDecision =
  | { kind: 'skip'; reason: string }
  | { kind: 'gate'; remove: boolean; sticky: boolean };

export function decidePost(args: {
  removePost: boolean;
  stickyComment: boolean;
  exemption: Exemption | null;
  alreadyGated: boolean;
}): PostDecision {
  if (args.exemption) {
    return { kind: 'skip', reason: `author exempt (${args.exemption})` };
  }
  if (args.alreadyGated) {
    return { kind: 'skip', reason: 'post already has a gate record' };
  }
  return { kind: 'gate', remove: args.removePost, sticky: args.stickyComment };
}

export type ReplyDecision =
  | { kind: 'ignore'; reason: string }
  | { kind: 'confirm'; approve: boolean };

/**
 * `record` and `parentId` are checked before `isOp` is known, so callers can
 * skip the post fetch; pass `isOp: undefined` for that first pass.
 */
export function decideReply(args: {
  record: GateRecord | null;
  parentId: string;
  isOp: boolean | undefined;
}): ReplyDecision {
  const { record } = args;
  if (!record) return { kind: 'ignore', reason: 'no gate record for post' };
  if (record.status !== 'pending') {
    return { kind: 'ignore', reason: 'already confirmed' };
  }
  if (args.parentId !== record.commentId) {
    return { kind: 'ignore', reason: 'not a reply to the request comment' };
  }
  if (args.isOp === false) {
    return { kind: 'ignore', reason: 'commenter is not OP' };
  }
  return { kind: 'confirm', approve: record.removedByUs };
}

/**
 * Parse the exempt-flairs setting: one flair text per line, trimmed,
 * lowercased; blank lines ignored.
 */
export function parseFlairList(raw: string): Set<string> {
  const out = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim().toLowerCase();
    if (t) out.add(t);
  }
  return out;
}

export function isExemptFlair(
  flairText: string | undefined,
  exempt: Set<string>
): boolean {
  const t = flairText?.trim().toLowerCase();
  return !!t && exempt.has(t);
}
