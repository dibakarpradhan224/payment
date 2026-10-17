import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

/** Per-token request log: method, route pattern, status, timing. Never the query string (it may hold the token), never bodies. */
export function attachApiLogging(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => { (req as any).startedAt = Date.now(); });
  app.addHook('onResponse', async (req, reply) => {
    if (!req.apiAuth) return;
    void prisma.apiRequestLog.create({
      data: {
        tokenId: req.apiAuth.tokenId, userId: req.apiAuth.userId, method: req.method,
        path: (req.routeOptions?.url ?? req.url.split('?')[0] ?? '').slice(0, 120),
        status: reply.statusCode, ip: req.ip, durationMs: Date.now() - ((req as any).startedAt ?? Date.now()),
      },
    }).catch(() => {});
  });
}
