import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { allowedOrigins, env, isProd } from './config/env.js';
import { AppError, ok } from './lib/errors.js';
import { prisma } from './lib/prisma.js';
import { originGuard } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { walletRoutes } from './routes/wallet.js';
import { depositRoutes } from './routes/deposits.js';
import { webhookRoutes } from './routes/webhooks.js';
import { apiTokenRoutes } from './routes/apiToken.js';
import { gatewayRoutes } from './routes/gateway.js';
import { shortApiRoutes, urlApiRoutes } from './routes/urlApi.js';
import { redactUrl } from './lib/redact.js';
import { paymentRoutes } from './routes/payments.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { siteRoutes } from './routes/site.js';
import { telegramAuthRoutes, telegramWebhookRoutes } from './routes/telegramRoutes.js';
import { bootstrapAdmin } from './services/adminAuth.js';
import { refreshSettings, payoutConfig, upiConfig, saveSetting } from './services/settings.js';
import { heartbeat, startJobs } from './jobs/index.js';

/** One-time: installs that saved the old ₹10 minimum move to ₹15. Later admin changes are never overridden. */
async function raiseMinWithdrawOnce() {
  const done = await prisma.systemSetting.findUnique({ where: { key: 'migration.min_withdraw_15' } });
  if (done) return;
  const rules = (await prisma.systemSetting.findUnique({ where: { key: 'withdraw.rules' } }))?.value as { minPaise?: string } | undefined;
  if (rules && BigInt(rules.minPaise ?? '0') < 1500n) await saveSetting('withdraw.rules', { ...rules, minPaise: '1500' });
  await saveSetting('migration.min_withdraw_15', { done: true });
}

export async function buildApp() {
  const app = Fastify({
    trustProxy: env.TRUST_PROXY === 'true',
    bodyLimit: 1_000_000,
    logger: {
      level: isProd ? 'info' : 'debug',
      serializers: { req: (r) => ({ method: r.method, url: redactUrl(r.url ?? ''), host: r.host, remoteAddress: r.ip }) }, // never log ?token=
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
  });

  await app.register(helmet);
  await app.register(cors, { origin: allowedOrigins, credentials: true });
  await app.register(cookie);
  // In-memory store: fine for one instance. Use a Redis store when running several.
  await app.register(rateLimit, {
    global: true,
    max: (req) => (req.url.startsWith('/api/') || req.url.startsWith('/webhooks/') ? 600 : 120),
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, c) => ({
      statusCode: 429,
      success: false,
      error: { code: 'RATE_LIMITED', message: `Too many requests. Try again in ${c.after}.` },
    }),
  });

  // Keep the exact bytes: webhook signatures are computed over the raw body.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      req.rawBody = body as string;
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e) {
      (e as any).statusCode = 400;
      done(e as Error, undefined);
    }
  });

  app.addHook('onRequest', originGuard);

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(422).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: err.issues[0]?.message ?? 'Invalid input.', fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.status).send({ success: false, error: { code: err.code, message: err.message, ...(err.details ?? {}) } });
    }
    if (err?.code === 'P2022' || err?.code === 'P2021') {
      req.log.error({ err }, 'database_out_of_date');
      return reply.code(500).send({ success: false, error: { code: 'DB_OUT_OF_DATE', message: isProd ? 'Something went wrong.' : 'The database is behind the code (missing column/table). Run the update in the README ("Updating an existing install"), then restart the backend.' } });
    }
    if (err?.statusCode === 429 && err.error) return reply.code(429).send({ success: false, error: err.error });
    if (err?.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ success: false, error: { code: 'BAD_REQUEST', message: 'Invalid request.' } });
    }
    req.log.error({ err }, 'unhandled_error'); // full detail stays server-side
    return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
  });

  app.get('/health', async (_req, reply) => {
    const checks: Record<string, string> = {};
    try { await prisma.$queryRaw`SELECT 1`; checks.database = 'up'; } catch { checks.database = 'down'; }
    // Queue = background workers. Stale heartbeat means payouts/webhooks are not progressing.
    const stale = env.RUN_JOBS === 'true' && [...heartbeat.values()].some((t) => Date.now() - t > 5 * 60_000);
    checks.workers = env.RUN_JOBS !== 'true' ? 'disabled' : stale ? 'stale' : 'up';
    // Provider status only says whether it is configured. No calls out, no secrets.
    checks.upi = upiConfig() ? 'configured' : 'missing';
    checks.payout = payoutConfig() ? 'configured' : 'missing';
    checks.telegram = env.TELEGRAM_BOT_TOKEN ? 'configured' : 'missing';
    const healthy = checks.database === 'up' && checks.workers !== 'stale';
    return reply.code(healthy ? 200 : 503).send({ success: healthy, data: { status: healthy ? 'ok' : 'degraded', checks } });
  });

  // Website / Mini App (cookie session)
  await app.register(authRoutes, { prefix: '/web/v1' });
  await app.register(walletRoutes, { prefix: '/web/v1' });
  await app.register(siteRoutes, { prefix: '/web/v1' });
  await app.register(depositRoutes, { prefix: '/web/v1' });
  await app.register(apiTokenRoutes, { prefix: '/web/v1' });
  await app.register(paymentRoutes, { prefix: '/web/v1' });
  await app.register(accountRoutes, { prefix: '/web/v1' });
  await app.register(telegramAuthRoutes, { prefix: '/web/v1' });
  await app.register(adminRoutes, { prefix: '/admin/v1' });
  // Public API gateway (Bearer token) and provider webhooks (signature)
  await app.register(gatewayRoutes, { prefix: '/api/v1' });
  await app.register(urlApiRoutes, { prefix: '/api/v1/url' });
  await app.register(shortApiRoutes, { prefix: '/api' });
  await app.register(webhookRoutes, { prefix: '/webhooks' });
  await app.register(telegramWebhookRoutes, { prefix: '/webhooks' });
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  (async () => {
    try {
      await refreshSettings().catch(() => {});
      await raiseMinWithdrawOnce().catch((e) => console.error('settings.min_withdraw_failed', e.message));
      await bootstrapAdmin().catch((e) => console.error('admin.bootstrap_failed', e.message));
      
      const app = await buildApp();
      const stopJobs = env.RUN_JOBS === 'true' ? startJobs() : () => {};
      
      const port = Number(process.env.PORT) || 4000;
      await app.listen({ port, host: '0.0.0.0' });
      console.log(`Server listening on port ${port}`);

      const stop = async () => { stopJobs(); await app.close(); await prisma.$disconnect(); process.exit(0); };
      process.on('SIGTERM', stop);
      process.on('SIGINT', stop);
    } catch (err) {
      console.error('FATAL_STARTUP_CRASH:', err);
      process.exit(1);
    }
  })();
}