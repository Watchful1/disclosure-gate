import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  OnAppInstallRequest,
  OnCommentCreateRequest,
  OnPostCreateRequest,
  T1,
  T3,
  TriggerResponse,
} from '@devvit/web/shared';
import { LOG_PREFIX, REDIS_KEYS, REMOVAL_NOTE, TTL } from '../config';
import {
  isApprovedUser,
  isModerator,
  refreshModeratorCache,
} from '../exemptions';
import {
  decidePost,
  decideReply,
  isExemptFlair,
  parseFlairList,
  type Exemption,
  type GateRecord,
} from '../gate';
import {
  approveIfOurs,
  distinguishComment,
  getAppAccountUsername,
  isAlreadyRemoved,
  withGrpcRetry,
} from '../reddit';
import { getSettings, type ResolvedSettings } from '../settings';
import { claimOnce, getGate, releaseClaim, setGate } from '../state';
import { commentLink, postLink, quoteReply, render } from '../template';

/**
 * Triggers run on PostCreate / CommentCreate, which fire after Reddit's safety
 * delay. By then AutoMod and the spam filter have acted, so a post they hold
 * shows as removed and is left alone, and a reply they removed is never
 * quoted into our comment.
 */
export const triggers = new Hono();

const ok = {} satisfies TriggerResponse;

function log(event: string, fields: Record<string, unknown>): void {
  const parts = [LOG_PREFIX, event];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    parts.push(
      `${k}=${typeof v === 'string' && !/\s/.test(v) ? v : JSON.stringify(v)}`
    );
  }
  console.log(parts.join(' '));
}

/** The trigger header normally carries this; fall back to the event payload. */
function subredditNameFrom(payloadName: string | undefined): string {
  return context.subredditName || payloadName || '';
}

async function findExemption(
  authorName: string,
  flairText: string | undefined,
  subredditName: string,
  settings: ResolvedSettings
): Promise<Exemption | null> {
  if (await isModerator(authorName, subredditName)) return 'moderator';
  if (isExemptFlair(flairText, parseFlairList(settings.exemptPostFlairs))) {
    return 'post-flair';
  }
  if (
    settings.exemptApprovedUsers &&
    (await isApprovedUser(authorName, subredditName))
  ) {
    return 'approved-user';
  }
  return null;
}

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  const subreddit = subredditNameFrom(input.subreddit?.name);
  log('installed', { subreddit });
  if (subreddit) await refreshModeratorCache(subreddit);
  return c.json<TriggerResponse>(ok, 200);
});

triggers.post('/on-post-create', async (c) => {
  let body: OnPostCreateRequest;
  try {
    body = await c.req.json<OnPostCreateRequest>();
  } catch {
    return c.json<TriggerResponse>(ok, 200);
  }
  const postIdRaw = body.post?.id;
  const authorName = body.author?.name;
  if (!postIdRaw || !authorName) return c.json<TriggerResponse>(ok, 200);
  const postId = postIdRaw as T3;
  const subreddit = subredditNameFrom(body.subreddit?.name);

  const seenKey = REDIS_KEYS.seen(postId);
  if (!(await claimOnce(seenKey, TTL.seen))) {
    log('skip-post', { postId, reason: 'duplicate delivery' });
    return c.json<TriggerResponse>(ok, 200);
  }

  try {
    await gatePost(postId, authorName, body.post?.linkFlair?.text, subreddit);
  } catch (err) {
    console.error(`${LOG_PREFIX} on-post-create error postId=${postId}`, err);
    // Let a redelivery retry. The gate record guards against double-gating.
    await releaseClaim(seenKey);
  }
  return c.json<TriggerResponse>(ok, 200);
});

async function gatePost(
  postId: T3,
  authorName: string,
  flairText: string | undefined,
  subreddit: string
): Promise<void> {
  const settings = await getSettings();
  const decision = decidePost({
    removePost: settings.removePost,
    stickyComment: settings.stickyComment,
    exemption: await findExemption(authorName, flairText, subreddit, settings),
    alreadyGated: (await getGate(postId)) !== null,
  });
  if (decision.kind === 'skip') {
    log('skip-post', { postId, author: authorName, reason: decision.reason });
    return;
  }

  let removedByUs = false;
  let alreadyRemoved = false;
  if (decision.remove) {
    try {
      const post = await withGrpcRetry(
        () => reddit.getPostById(postId),
        'gatePost:getPostById'
      );
      const app = getAppAccountUsername()?.toLowerCase();
      if (post.removed && app && post.removedBy?.toLowerCase() === app) {
        // Our own removal from an earlier delivery that failed partway.
        removedByUs = true;
      } else if (isAlreadyRemoved(post)) {
        // AutoMod, the spam filter or a mod already holds it. Removing again
        // would make us the recorded remover, and OP's reply would then
        // approve a post someone else meant to hold.
        alreadyRemoved = true;
      } else {
        await withGrpcRetry(() => post.remove(), 'gatePost:remove');
        removedByUs = true;
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} remove failed postId=${postId}`, err);
    }
    if (removedByUs) {
      try {
        await reddit.addRemovalNote({
          itemIds: [postId],
          reasonId: '',
          modNote: REMOVAL_NOTE,
        });
      } catch (err) {
        console.warn(
          `${LOG_PREFIX} addRemovalNote failed postId=${postId}`,
          err
        );
      }
    }
  }

  /** Never leave a post removed with nothing telling OP why. */
  const rollback = async (why: string) => {
    if (!removedByUs) return;
    try {
      const r = await approveIfOurs(postId, true);
      log('rolled-back', {
        postId,
        why,
        approved: r.approved,
        reason: r.reason,
      });
    } catch (err) {
      console.error(
        `${LOG_PREFIX} STUCK postId=${postId} rollback approve failed after: ${why}`,
        err
      );
    }
  };

  const text = render(settings.requestText, {
    author: authorName,
    subreddit,
    post_link: postLink(subreddit, postId),
  });

  // Not retried: if the first attempt landed but its response was lost, a
  // retry would post a second request comment.
  let comment;
  try {
    comment = await reddit.submitComment({ id: postId, text, runAs: 'APP' });
  } catch (err) {
    console.error(`${LOG_PREFIX} request comment failed postId=${postId}`, err);
    await rollback('request comment failed');
    return;
  }

  // Write the record before anything else, so a fast reply from OP finds it.
  const record: GateRecord = {
    commentId: comment.id,
    status: 'pending',
    removedByUs,
    distinguished: false,
    createdAt: Date.now(),
  };
  try {
    await setGate(postId, record);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} gate record write failed postId=${postId}`,
      err
    );
    // Without a record OP's reply can't be matched, so undo the gate.
    await rollback('gate record write failed');
    await comment
      .delete()
      .catch((e: unknown) =>
        console.warn(
          `${LOG_PREFIX} delete request comment failed postId=${postId}`,
          e
        )
      );
    return;
  }

  const distinguished = await distinguishComment(
    comment,
    decision.sticky,
    postId,
    'gatePost:distinguish'
  );
  if (distinguished) {
    await setGate(postId, { ...record, distinguished }).catch((e: unknown) =>
      // Harmless: the next edit re-attempts the distinguish.
      console.warn(
        `${LOG_PREFIX} distinguished flag write failed postId=${postId}`,
        e
      )
    );
  }

  log('gated', {
    postId,
    author: authorName,
    commentId: comment.id,
    removed: removedByUs,
    alreadyRemoved: alreadyRemoved || undefined,
    sticky: decision.sticky && distinguished,
  });
}

triggers.post('/on-comment-create', async (c) => {
  let body: OnCommentCreateRequest;
  try {
    body = await c.req.json<OnCommentCreateRequest>();
  } catch {
    return c.json<TriggerResponse>(ok, 200);
  }
  const comment = body.comment;
  const author = body.author;
  if (!comment?.id || !comment.postId || !comment.parentId || !author?.id) {
    return c.json<TriggerResponse>(ok, 200);
  }
  if (author.name?.toLowerCase() === getAppAccountUsername()?.toLowerCase()) {
    return c.json<TriggerResponse>(ok, 200);
  }

  const postId = comment.postId as T3;
  try {
    await handleReply({
      postId,
      commentId: comment.id,
      parentId: comment.parentId,
      authorId: author.id,
      authorName: author.name ?? '',
      postAuthorId: body.post?.authorId,
      subreddit: subredditNameFrom(body.subreddit?.name),
    });
  } catch (err) {
    console.error(
      `${LOG_PREFIX} on-comment-create error postId=${postId} commentId=${comment.id}`,
      err
    );
  }
  return c.json<TriggerResponse>(ok, 200);
});

async function handleReply(input: {
  postId: T3;
  commentId: string;
  parentId: string;
  authorId: string;
  authorName: string;
  postAuthorId: string | undefined;
  subreddit: string;
}): Promise<void> {
  const { postId } = input;
  const record = await getGate(postId);

  // First pass without the OP check, so most comments cost one Redis read.
  const pre = decideReply({
    record,
    parentId: input.parentId,
    isOp: undefined,
  });
  if (pre.kind === 'ignore' || !record) {
    // OP replying to a comment on a post with no record is the "stuck" case
    // worth seeing in the logs; everything else is routine.
    if (
      !record &&
      input.postAuthorId === input.authorId &&
      input.parentId.startsWith('t1_')
    ) {
      log('ignore-reply', {
        postId,
        commentId: input.commentId,
        reason: 'OP reply on a post with no gate record',
      });
    }
    return;
  }

  let postAuthorId = input.postAuthorId;
  if (!postAuthorId) {
    const post = await withGrpcRetry(
      () => reddit.getPostById(postId),
      'handleReply:getPostById'
    );
    postAuthorId = post.authorId;
  }
  const decision = decideReply({
    record,
    parentId: input.parentId,
    isOp: postAuthorId === input.authorId,
  });
  if (decision.kind === 'ignore') {
    log('ignore-reply', {
      postId,
      commentId: input.commentId,
      author: input.authorName,
      reason: decision.reason,
    });
    return;
  }

  // Re-read the reply: if AutoMod or the spam filter removed it, don't quote
  // it into our comment. Not locked yet, so OP's next reply can still count.
  const reply = await withGrpcRetry(
    () => reddit.getCommentById(input.commentId as T1),
    'handleReply:getReply'
  );
  if (reply.removed || reply.spam) {
    log('ignore-reply', {
      postId,
      commentId: input.commentId,
      reason: 'reply is removed or spam',
    });
    return;
  }

  const lockKey = REDIS_KEYS.confirmLock(postId);
  if (!(await claimOnce(lockKey, TTL.confirmLock))) {
    log('ignore-reply', {
      postId,
      commentId: input.commentId,
      reason: 'another reply is being confirmed',
    });
    return;
  }

  try {
    await confirm(input, record, decision.approve, reply.body);
  } catch (err) {
    // Leave the record pending and release the lock, so OP's next reply
    // retries. Edit and approve are both safe to repeat.
    await releaseClaim(lockKey);
    throw err;
  }
}

async function confirm(
  input: {
    postId: T3;
    commentId: string;
    authorName: string;
    subreddit: string;
  },
  record: GateRecord,
  approve: boolean,
  replyBody: string
): Promise<void> {
  const { postId, subreddit } = input;
  const settings = await getSettings();
  const text = render(settings.confirmedText, {
    author: input.authorName,
    subreddit,
    post_link: postLink(subreddit, postId),
    reply: quoteReply(replyBody),
    reply_link: commentLink(subreddit, postId, input.commentId),
  });

  let edited = false;
  let distinguished = record.distinguished;
  try {
    const botComment = await withGrpcRetry(
      () => reddit.getCommentById(record.commentId as T1),
      'confirm:getCommentById'
    );
    await withGrpcRetry(() => botComment.edit({ text }), 'confirm:edit');
    edited = true;
    // Self-heal a pin that failed when the comment was created.
    if (!distinguished) {
      distinguished = await distinguishComment(
        botComment,
        settings.stickyComment,
        postId,
        'confirm:distinguish'
      );
    }
  } catch (err) {
    console.error(
      `${LOG_PREFIX} edit request comment failed postId=${postId} commentId=${record.commentId}`,
      err
    );
  }

  // OP did their part, so approve even if the edit failed.
  let approval = { approved: false, reason: 'app did not remove the post' };
  if (approve) approval = await approveIfOurs(postId, record.removedByUs);

  if (edited) {
    await setGate(postId, { ...record, status: 'confirmed', distinguished });
  } else {
    // Keep it pending so OP's next reply retries the edit.
    await releaseClaim(REDIS_KEYS.confirmLock(postId));
  }

  log('confirmed', {
    postId,
    author: input.authorName,
    replyId: input.commentId,
    edited,
    approved: approval.approved,
    reason: approval.reason,
  });
}
