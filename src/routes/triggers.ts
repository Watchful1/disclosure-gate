import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import type { T1, T3 } from '@devvit/shared-types/tid.js';
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
  withGrpcRetry,
} from '../reddit';
import { getSettings, type ResolvedSettings } from '../settings';
import { claimOnce, getGate, setGate } from '../state';
import { commentLink, postLink, quoteReply, render } from '../template';

export const triggers = new Hono();

// Devvit doesn't publish exhaustive TS shapes for trigger bodies; they mirror
// the public-api PostSubmit / CommentSubmit events. We declare what we read.
type UserLike = { id?: string; name?: string };
type PostLike = {
  id?: string;
  authorId?: string;
  linkFlair?: { text?: string };
};
type CommentLike = {
  id?: string;
  parentId?: string;
  postId?: string;
  body?: string;
};
type PostSubmitBody = { post?: PostLike; author?: UserLike };
type CommentSubmitBody = {
  post?: PostLike;
  comment?: CommentLike;
  author?: UserLike;
};

const ok = { status: 'success' } as const;

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

async function findExemption(
  authorName: string,
  flairText: string | undefined,
  settings: ResolvedSettings
): Promise<Exemption | null> {
  if (await isModerator(authorName)) return 'moderator';
  if (isExemptFlair(flairText, parseFlairList(settings.exemptPostFlairs))) {
    return 'post-flair';
  }
  if (settings.exemptApprovedUsers && (await isApprovedUser(authorName))) {
    return 'approved-user';
  }
  return null;
}

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<OnAppInstallRequest>();
  log('installed', { subreddit: input.subreddit?.name });
  try {
    await refreshModeratorCache();
  } catch (err) {
    console.warn(`${LOG_PREFIX} on-app-install: mod cache warm failed`, err);
  }
  return c.json<TriggerResponse>(ok, 200);
});

triggers.post('/on-post-submit', async (c) => {
  let body: PostSubmitBody;
  try {
    body = await c.req.json<PostSubmitBody>();
  } catch {
    return c.json<TriggerResponse>(ok, 200);
  }
  const postIdRaw = body.post?.id;
  const authorName = body.author?.name;
  if (!postIdRaw || !authorName) return c.json<TriggerResponse>(ok, 200);
  const postId = postIdRaw as T3;

  if (!(await claimOnce(REDIS_KEYS.seen(postId), TTL.seen))) {
    log('skip-post', { postId, reason: 'duplicate delivery' });
    return c.json<TriggerResponse>(ok, 200);
  }

  try {
    await gatePost(postId, authorName, body.post?.linkFlair?.text);
  } catch (err) {
    console.error(`${LOG_PREFIX} on-post-submit error postId=${postId}`, err);
  }
  return c.json<TriggerResponse>(ok, 200);
});

async function gatePost(
  postId: T3,
  authorName: string,
  flairText: string | undefined
): Promise<void> {
  const settings = await getSettings();
  const decision = decidePost({
    removePost: settings.removePost,
    stickyComment: settings.stickyComment,
    exemption: await findExemption(authorName, flairText, settings),
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
      // If AutoMod, the spam filter or a mod already removed it, leave that
      // removal alone. Removing again would make us the recorded remover, and
      // OP's reply would then approve a post someone else meant to hold.
      if (post.removed) {
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

  const subreddit = context.subredditName ?? '';
  const text = render(settings.requestText, {
    author: authorName,
    subreddit,
    post_link: postLink(subreddit, postId),
  });

  let comment;
  try {
    comment = await withGrpcRetry(
      () => reddit.submitComment({ id: postId, text, runAs: 'APP' }),
      'gatePost:submitComment'
    );
  } catch (err) {
    console.error(`${LOG_PREFIX} request comment failed postId=${postId}`, err);
    // Never leave a post removed with nothing telling OP why.
    if (removedByUs) {
      await approveIfOurs(postId, true).catch((e: unknown) =>
        console.error(
          `${LOG_PREFIX} rollback approve failed postId=${postId}`,
          e
        )
      );
    }
    return;
  }

  const distinguished = await distinguishComment(
    comment,
    decision.sticky,
    postId,
    'gatePost:distinguish'
  );

  const record: GateRecord = {
    commentId: comment.id,
    status: 'pending',
    removedByUs,
    distinguished,
    createdAt: Date.now(),
  };
  await setGate(postId, record);
  log('gated', {
    postId,
    author: authorName,
    commentId: comment.id,
    removed: removedByUs,
    alreadyRemoved: alreadyRemoved || undefined,
    sticky: decision.sticky && distinguished,
  });
}

triggers.post('/on-comment-submit', async (c) => {
  let body: CommentSubmitBody;
  try {
    body = await c.req.json<CommentSubmitBody>();
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

  try {
    await handleReply({
      postId: comment.postId as T3,
      commentId: comment.id,
      parentId: comment.parentId,
      authorId: author.id,
      authorName: author.name ?? '',
      body: comment.body ?? '',
      postAuthorId: body.post?.authorId,
    });
  } catch (err) {
    console.error(
      `${LOG_PREFIX} on-comment-submit error commentId=${comment.id}`,
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
  body: string;
  postAuthorId: string | undefined;
}): Promise<void> {
  const { postId } = input;
  const record = await getGate(postId);

  // First pass without the OP check, so most comments cost one Redis read.
  const pre = decideReply({
    record,
    parentId: input.parentId,
    isOp: undefined,
  });
  if (pre.kind === 'ignore' || !record) return;

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

  if (!(await claimOnce(REDIS_KEYS.confirmClaim(postId), TTL.gate))) {
    log('ignore-reply', {
      postId,
      commentId: input.commentId,
      reason: 'already confirming',
    });
    return;
  }

  const settings = await getSettings();
  const subreddit = context.subredditName ?? '';
  const text = render(settings.confirmedText, {
    author: input.authorName,
    subreddit,
    post_link: postLink(subreddit, postId),
    reply: quoteReply(input.body),
    reply_link: commentLink(subreddit, postId, input.commentId),
  });

  let distinguished = record.distinguished;
  try {
    const botComment = await withGrpcRetry(
      () => reddit.getCommentById(record.commentId as T1),
      'handleReply:getCommentById'
    );
    await withGrpcRetry(() => botComment.edit({ text }), 'handleReply:edit');
    // Self-heal a pin that failed when the comment was created.
    if (!distinguished) {
      distinguished = await distinguishComment(
        botComment,
        settings.stickyComment,
        postId,
        'handleReply:distinguish'
      );
    }
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} edit request comment failed postId=${postId}`,
      err
    );
  }

  await setGate(postId, { ...record, status: 'confirmed', distinguished });

  let approval: { approved: boolean; reason: string } = {
    approved: false,
    reason: 'app did not remove the post',
  };
  if (decision.approve) {
    approval = await approveIfOurs(postId, record.removedByUs);
  }
  log('confirmed', {
    postId,
    author: input.authorName,
    replyId: input.commentId,
    approved: approval.approved,
    reason: approval.reason,
  });
}
