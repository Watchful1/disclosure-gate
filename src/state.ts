import { redis } from '@devvit/web/server';
import { REDIS_KEYS, TTL } from './config';
import type { GateRecord } from './gate';

export async function getGate(postId: string): Promise<GateRecord | null> {
  const raw = await redis.get(REDIS_KEYS.gate(postId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GateRecord;
  } catch {
    return null;
  }
}

/**
 * Write the record. The TTL is measured from creation, not from this write,
 * so confirming a gate late doesn't extend it.
 */
export async function setGate(
  postId: string,
  record: GateRecord
): Promise<void> {
  const expiresAt = record.createdAt + TTL.gate * 1000;
  await redis.set(REDIS_KEYS.gate(postId), JSON.stringify(record), {
    expiration: new Date(Math.max(expiresAt, Date.now() + 60_000)),
  });
}

/**
 * SETNX guard for at-least-once trigger deliveries. Returns true the first
 * time a key is seen (caller should proceed), false afterwards.
 */
export async function claimOnce(
  key: string,
  ttlSeconds: number
): Promise<boolean> {
  const result = await redis.set(key, '1', {
    nx: true,
    expiration: new Date(Date.now() + ttlSeconds * 1000),
  });
  return !!result;
}
