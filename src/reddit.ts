import { context, reddit } from '@devvit/web/server';
import type { T3 } from '@devvit/shared-types/tid.js';
import { LOG_PREFIX } from './config';

/**
 * gRPC code 2 (UNKNOWN) and 14 (UNAVAILABLE) typically mean a transient
 * connection issue — most commonly an HTTP/2 GOAWAY from Reddit's backend
 * gracefully closing a connection. Retrying once almost always succeeds.
 */
function isTransientGrpcError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return code === 2 || code === 14;
}

/**
 * Run an async Reddit-API call; on a transient gRPC error, retry once.
 * Non-transient errors propagate unchanged.
 */
export async function withGrpcRetry<T>(
  fn: () => Promise<T>,
  label: string
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientGrpcError(err)) throw err;
    console.warn(
      `${LOG_PREFIX} ${label}: transient gRPC error, retrying once`,
      err
    );
    return await fn();
  }
}

/** Username of the app account, from the request context. */
export function getAppAccountUsername(): string | undefined {
  return context.appSlug;
}

type DistinguishableComment = {
  distinguish(sticky: boolean): Promise<unknown>;
};

/**
 * Distinguish (and optionally sticky) a comment. Returns whether it landed.
 *
 * Reddit intermittently 500s on Distinguish. Without a retry the comment
 * stays posted but sorted like any other reply, which reads to mods as "the
 * bot never commented".
 */
export async function distinguishComment(
  comment: DistinguishableComment,
  sticky: boolean,
  postId: string,
  label: string
): Promise<boolean> {
  try {
    await withGrpcRetry(() => comment.distinguish(sticky), label);
    return true;
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} ${label} failed postId=${postId} reason="comment posted but not distinguished"`,
      err
    );
    return false;
  }
}

export type ApprovalGateInput = {
  /** Post is currently in a removed state. */
  removed: boolean;
  /** Reddit's username for whoever performed the current removal. */
  removedBy: string | undefined;
  /** Our app account's username. */
  appAccount: string | undefined;
  /** True if our gate record says we removed the post. */
  marker: boolean;
};

export type ApprovalGateResult = {
  approve: boolean;
  /** True when removedBy names an account that isn't us. */
  removedBySomeoneElse: boolean;
  reason: string;
};

/**
 * Decides whether it's safe to approve a post.
 *
 * `removedBy` is authoritative when Reddit populates it: it names the account
 * that owns the *current* removal. Our marker only records that we removed
 * the post at some point, so it stays set even after another mod or bot
 * re-removes it — trusting it alone would undo their removal.
 *
 * When `removedBy` is absent (Reddit doesn't always populate it, e.g. for
 * AutoMod filtering) we fall back to the marker.
 */
export function evaluateApprovalGate(
  input: ApprovalGateInput
): ApprovalGateResult {
  if (!input.removed) {
    return {
      approve: true,
      removedBySomeoneElse: false,
      reason: 'post is not removed',
    };
  }

  const remover = input.removedBy?.trim().toLowerCase();
  const us = input.appAccount?.trim().toLowerCase();

  if (remover && us) {
    if (remover === us) {
      return {
        approve: true,
        removedBySomeoneElse: false,
        reason: 'current removal is ours (removedBy matches app account)',
      };
    }
    return {
      approve: false,
      removedBySomeoneElse: true,
      reason: `current removal belongs to u/${input.removedBy}`,
    };
  }

  if (input.marker) {
    return {
      approve: true,
      removedBySomeoneElse: false,
      reason: 'removedBy unavailable; removed-by-us marker present',
    };
  }
  return {
    approve: false,
    removedBySomeoneElse: false,
    reason: 'removedBy unavailable and no removed-by-us marker',
  };
}

/**
 * Approve a post, but only if the app owns the current removal. Returns true
 * if approve() was called. This is the single chokepoint for "don't undo
 * someone else's removal".
 */
export async function approveIfOurs(
  postId: T3,
  removedByUs: boolean
): Promise<{ approved: boolean; reason: string }> {
  const post = await withGrpcRetry(
    () => reddit.getPostById(postId),
    'approveIfOurs:getPostById'
  );
  const gate = evaluateApprovalGate({
    removed: post.removed,
    removedBy: post.removedBy,
    appAccount: getAppAccountUsername(),
    marker: removedByUs,
  });
  if (!gate.approve) return { approved: false, reason: gate.reason };
  if (!post.removed) return { approved: false, reason: gate.reason };
  await withGrpcRetry(() => post.approve(), 'approveIfOurs:approve');
  return { approved: true, reason: gate.reason };
}
