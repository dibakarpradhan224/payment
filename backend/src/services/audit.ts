import { prisma } from '../lib/prisma.js';

const SENSITIVE = /pass|pin|otp|token|secret|authorization|cookie/i;

function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, SENSITIVE.test(k) ? '[REDACTED]' : redact(val, depth + 1)]),
  );
}

export interface AuditEntry {
  actorType?: 'USER' | 'ADMIN' | 'SYSTEM';
  actorId?: string | null;
  action: string;
  result: 'SUCCESS' | 'FAILURE';
  ip?: string | null;
  sessionId?: string | null;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/** Audit failures must never break the business operation. */
export async function audit(e: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorType: e.actorType ?? 'USER',
        actorId: e.actorId ?? null,
        action: e.action,
        result: e.result,
        ip: e.ip ?? null,
        sessionId: e.sessionId ?? null,
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        metadata: e.metadata ? (redact(e.metadata) as object) : undefined,
      },
    });
  } catch (err) {
    console.error('audit.write_failed', (err as Error).message);
  }
}
