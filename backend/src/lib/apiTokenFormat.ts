import { createHash, randomBytes } from 'node:crypto';

export const API_TOKEN_RE = /^pg_live_[A-Za-z0-9_-]{43}$/;
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** 256 bits of randomness; only the SHA-256 is stored, so the plaintext is shown exactly once. */
export function generateApiToken() {
  const token = `pg_live_${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 12) };
}
