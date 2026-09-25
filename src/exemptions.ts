import { context, reddit, redis } from '@devvit/web/server';
import { LOG_PREFIX, REDIS_KEYS, TTL } from './config';
import { getAppAccountUsername, withGrpcRetry } from './reddit';

/**
 * Pull the moderator list for the installed subreddit and cache it in Redis.
 * Called on install to warm the cache, and lazily when the cache expires.
 */
export async function refreshModeratorCache(): Promise<Set<string>> {
  const subredditName = context.subredditName;
  if (!subredditName) return new Set();

  const usernames: string[] = [];
  try {
    const mods = await reddit.getModerators({ subredditName }).all();
    for (const user of mods) {
      if (user.username) usernames.push(user.username.toLowerCase());
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} refreshModeratorCache failed`, err);
    return new Set();
  }
  await redis.set(REDIS_KEYS.modsCache, JSON.stringify(usernames), {
    expiration: new Date(Date.now() + TTL.modsCache * 1000),
  });
  return new Set(usernames);
}

async function loadCachedMods(): Promise<Set<string> | null> {
  const raw = await redis.get(REDIS_KEYS.modsCache);
  if (!raw) return null;
  try {
    return new Set((JSON.parse(raw) as string[]).map((u) => u.toLowerCase()));
  } catch {
    return null;
  }
}

/** True if `username` moderates the subreddit or is the app account. */
export async function isModerator(username: string): Promise<boolean> {
  const lower = username.toLowerCase();
  if (lower === getAppAccountUsername()?.toLowerCase()) return true;
  const mods = (await loadCachedMods()) ?? (await refreshModeratorCache());
  return mods.has(lower);
}

/**
 * True if `username` is an approved user of the subreddit. Only called when
 * the exemptApprovedUsers toggle is on. A lookup failure counts as not
 * approved, so the gate errs toward asking for disclosure.
 */
export async function isApprovedUser(username: string): Promise<boolean> {
  const subredditName = context.subredditName;
  if (!subredditName) return false;
  try {
    const users = await withGrpcRetry(
      () => reddit.getApprovedUsers({ subredditName, username }).all(),
      'isApprovedUser'
    );
    const lower = username.toLowerCase();
    return users.some((u) => u.username.toLowerCase() === lower);
  } catch (err) {
    console.warn(`${LOG_PREFIX} isApprovedUser failed user=${username}`, err);
    return false;
  }
}
