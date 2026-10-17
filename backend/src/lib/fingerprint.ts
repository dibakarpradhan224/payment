import { createHash } from 'node:crypto';

const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]))
  : v;
export const fingerprintOf = (body: unknown) => createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');

