import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError, ok } from '../lib/errors.js';
import { hashSecret } from '../lib/crypto.js';
import { amountSchema, money } from '../lib/money.js';
import { maskSecret, seal } from '../lib/secretBox.js';
import { password } from '../validators/auth.js';
import { txDto } from '../services/transactions.js';
import { adminAudit, adminLogin, ADMIN_COOKIE, requireAdmin, requirePerm } from '../services/adminAuth.js';
import { adminResolveUtr, ingestBankCredit } from '../services/utr.js';
import { finalizeFailure, finalizeSuccess, withdrawalDto } from '../services/withdrawals.js';
import { refundDebit } from '../services/wallet.js';
import { getActiveSlabs, parseSlabs } from '../services/taxSettings.js';
import { DEFAULT_SITE, getAutoMatchByAmount, getDepositLimits, getWithdrawRules, payoutConfig, saveSetting, siteConfig, upiConfig } from '../services/settings.js';
import { adminSettleOrder } from '../services/upiOrders.js';
import { previewRequest, type PayoutConfig } from '../providers/payout.js';
import { revokeAllSessions } from '../services/session.js';
import { sha256 } from '../lib/crypto.js';
import { notify } from '../services/notify.js';

const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });
const page = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.string().uuid().optional() });
const cursorArgs = (c?: string): { cursor?: { id: string }; skip?: number } => (c ? { cursor: { id: c }, skip: 1 } : {});
const reason = z.string().trim().min(3).max(200);
const istDayStart = () => { const t = new Date(Date.now() + 19_800_000); t.setUTCHours(0, 0, 0, 0); return new Date(t.getTime() - 19_800_000); };
const big = (v: bigint | null | undefined) => (v ?? 0n);

export async function adminRoutes(app: FastifyInstance) {
  // ---------- auth ----------
  app.post('/auth/login', limit(10), async (req, reply) => {
    const b = z.object({ email: z.string().email(), password: z.string().min(1).max(128) }).parse(req.body);
    const a = await adminLogin(req, reply, b.email, b.password);
    return ok({ admin: { id: a.id, email: a.email, role: a.role } });
  });
  app.post('/auth/logout', { preHandler: requireAdmin }, async (req, reply) => {
    await prisma.adminSession.update({ where: { id: req.admin!.sessionId }, data: { revokedAt: new Date() } });
    reply.clearCookie(ADMIN_COOKIE, { path: '/' });
    return ok({ message: 'Logged out.' });
  });
  app.get('/auth/me', { preHandler: requireAdmin }, async (req) => ok({ admin: { id: req.admin!.id, email: req.admin!.email, role: req.admin!.role } }));

  // ---------- dashboard & analytics ----------
  app.get('/dashboard', { preHandler: requirePerm('analytics:read') }, async () => {
    const today = istDayStart();
    const agg = (type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'PAYMENT', since?: Date) =>
      prisma.transaction.aggregate({ _sum: { grossAmount: true }, _count: true, where: { type, status: 'SUCCESSFUL', ...(since ? { createdAt: { gte: since } } : {}) } });
    const [users, active, dep, wd, tr, pay, depT, wdT, trT, rev, revT, pendOrders, pendUtr, pendWd, failedOrders, failedUtr, newToday] = await Promise.all([
      prisma.user.count(), prisma.session.findMany({ where: { lastSeenAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, distinct: ['userId'], select: { userId: true } }),
      agg('DEPOSIT'), agg('WITHDRAWAL'), agg('TRANSFER'), agg('PAYMENT'), agg('DEPOSIT', today), agg('WITHDRAWAL', today), agg('TRANSFER', today),
      prisma.transaction.aggregate({ _sum: { tax: true, fee: true }, where: { status: 'SUCCESSFUL' } }),
      prisma.transaction.aggregate({ _sum: { tax: true, fee: true }, where: { status: 'SUCCESSFUL', createdAt: { gte: today } } }),
      prisma.upiOrder.count({ where: { status: 'CREATED', expiresAt: { gt: new Date() } } }),
      prisma.utrSubmission.count({ where: { status: { in: ['PENDING', 'MANUAL_REVIEW'] } } }),
      prisma.withdrawal.count({ where: { status: { in: ['PENDING', 'PROCESSING', 'MANUAL_REVIEW'] } } }),
      prisma.upiOrder.count({ where: { status: 'EXPIRED' } }), prisma.utrSubmission.count({ where: { status: 'REJECTED' } }),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
    ]);
    const sum = (a: { _sum: { grossAmount: bigint | null }; _count: number }) => ({ volume: money(big(a._sum.grossAmount)), count: a._count });
    return ok({
      totals: { users, activeUsers: active.length, deposits: sum(dep), withdrawals: sum(wd), transfers: sum(tr), paymentVolume: sum(pay), revenue: money(big(rev._sum.tax) + big(rev._sum.fee)) },
      pending: { payments: pendOrders + pendUtr, withdrawals: pendWd, reconciliation: pendUtr }, failedPayments: failedOrders + failedUtr,
      today: { deposits: sum(depT), withdrawals: sum(wdT), transfers: sum(trT), revenue: money(big(revT._sum.tax) + big(revT._sum.fee)), newUsers: newToday },
    });
  });

  app.get('/analytics', { preHandler: requirePerm('analytics:read') }, async (req) => {
    const days = z.coerce.number().int().min(1).max(365).default(30).parse((req.query as any).days);
    const since = new Date(Date.now() - days * 86_400_000);
    const tx = await prisma.$queryRaw<{ day: Date; type: string; n: number; volume: bigint; revenue: bigint }[]>(Prisma.sql`
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'Asia/Kolkata')::date AS day, "type"::text AS type, COUNT(*)::int AS n,
             COALESCE(SUM("grossAmount"),0)::bigint AS volume, COALESCE(SUM("tax" + "fee"),0)::bigint AS revenue
      FROM "Transaction" WHERE "createdAt" >= ${since} AND "status" = 'SUCCESSFUL' GROUP BY 1, 2 ORDER BY 1`);
    const users = await prisma.$queryRaw<{ day: Date; n: number }[]>(Prisma.sql`
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'Asia/Kolkata')::date AS day, COUNT(*)::int AS n FROM "User" WHERE "createdAt" >= ${since} GROUP BY 1 ORDER BY 1`);
    const [rzPaid, rzAll] = await Promise.all([prisma.upiOrder.count({ where: { status: 'PAID', createdAt: { gte: since } } }), prisma.upiOrder.count({ where: { createdAt: { gte: since } } })]);
    return ok({
      days, successRate: rzAll ? Math.round((rzPaid / rzAll) * 1000) / 10 : null,
      series: tx.map((r) => ({ day: r.day, type: r.type, count: r.n, volume: r.volume.toString(), revenue: r.revenue.toString() })),
      users: users.map((r) => ({ day: r.day, count: r.n })),
    });
  });

  // ---------- users ----------
  app.get('/users', { preHandler: requirePerm('users:read') }, async (req) => {
    const q = page.extend({ q: z.string().trim().max(100).optional() }).parse(req.query);
    const where: Prisma.UserWhereInput = q.q ? { OR: [{ email: { contains: q.q.toLowerCase() } }, { mobile: { contains: q.q } }, { paymentId: q.q.toUpperCase() }, ...(/^[0-9a-f-]{36}$/i.test(q.q) ? [{ id: q.q }] : [])] } : {};
    const rows = await prisma.user.findMany({ where, take: q.limit + 1, ...cursorArgs(q.cursor), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { wallet: true } });
    const more = rows.length > q.limit; const list = more ? rows.slice(0, q.limit) : rows;
    return ok({ users: list.map((u) => ({ id: u.id, email: u.email, mobile: u.mobile, paymentId: u.paymentId, status: u.status, createdAt: u.createdAt, balance: money(u.wallet?.available ?? 0n), frozen: u.wallet?.frozen ?? false })), nextCursor: more ? list[list.length - 1]!.id : null });
  });

  app.get<{ Params: { id: string } }>('/users/:id', { preHandler: requirePerm('users:read') }, async (req) => {
    const u = await prisma.user.findUnique({ where: { id: req.params.id }, include: { wallet: true, riskFlags: { orderBy: { createdAt: 'desc' }, take: 20 }, apiTokens: { where: { status: 'ACTIVE' }, take: 1 } } });
    if (!u) throw new AppError('NOT_FOUND', 'User not found.', 404);
    const [tx, wd, dep, utr, sessions, apiCalls] = await Promise.all([
      prisma.transaction.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.withdrawal.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.upiOrder.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.utrSubmission.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.session.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 5, select: { ip: true, userAgent: true, createdAt: true, revokedAt: true } }),
      prisma.apiRequestLog.count({ where: { userId: u.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    ]);
    const w = u.wallet;
    return ok({
      user: { id: u.id, email: u.email, mobile: u.mobile, name: u.name, paymentId: u.paymentId, status: u.status, pinSet: !!u.pinHash, createdAt: u.createdAt },
      wallet: w && { available: money(w.available), locked: money(w.locked), frozen: w.frozen, totalDeposited: money(w.totalDeposited), totalWithdrawn: money(w.totalWithdrawn), totalTransferred: money(w.totalTransferred), totalReceived: money(w.totalReceived), totalFees: money(w.totalFees) },
      riskFlags: u.riskFlags, transactions: tx.map(txDto), withdrawals: wd.map(withdrawalDto), sessions,
      deposits: { upi: dep.map((d) => ({ id: d.orderRef, amount: money(d.amount), status: d.status, createdAt: d.createdAt })), utr: utr.map((s) => ({ id: s.id, utr: s.utr, amount: money(s.amount), status: s.status, reason: s.reason })) },
      api: { activeToken: u.apiTokens[0] ? { prefix: u.apiTokens[0].prefix, scopes: u.apiTokens[0].scopes, lastUsedAt: u.apiTokens[0].lastUsedAt } : null, callsLast24h: apiCalls },
    });
  });

  app.post<{ Params: { id: string } }>('/users/:id/action', { preHandler: requirePerm('users:write'), ...limit(30) }, async (req) => {
    const b = z.object({ action: z.enum(['suspend', 'unsuspend', 'freeze', 'unfreeze', 'reset-pin']), reason }).parse(req.body);
    const id = req.params.id;
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) throw new AppError('NOT_FOUND', 'User not found.', 404);
    if (b.action === 'reset-pin' && req.admin!.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only a Super Admin can reset security.', 403);
    if (b.action === 'suspend') { await prisma.user.update({ where: { id }, data: { status: 'SUSPENDED' } }); await revokeAllSessions(id); }
    if (b.action === 'unsuspend') await prisma.user.update({ where: { id }, data: { status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null } });
    if (b.action === 'freeze') await prisma.wallet.update({ where: { userId: id }, data: { frozen: true } });
    if (b.action === 'unfreeze') await prisma.wallet.update({ where: { userId: id }, data: { frozen: false } });
    if (b.action === 'reset-pin') { await prisma.user.update({ where: { id }, data: { pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null } }); await revokeAllSessions(id); } // user must log in and create a new PIN
    await adminAudit(req, `admin.user.${b.action}`, 'User', id, { reason: b.reason });
    return ok({ message: 'Done.' });
  });

  // ---------- transactions (search by any identifier) ----------
  app.get('/transactions', { preHandler: requirePerm('tx:read') }, async (req) => {
    const q = page.extend({ q: z.string().trim().min(1).max(100).optional() }).parse(req.query);
    let where: Prisma.TransactionWhereInput = {};
    if (q.q) {
      const s = q.q;
      const [users, ord, wd, utr] = await Promise.all([
        prisma.user.findMany({ where: { OR: [{ email: s.toLowerCase() }, { mobile: s }, { paymentId: s.toUpperCase() }, ...(/^[0-9a-f-]{36}$/i.test(s) ? [{ id: s }] : [])] }, select: { id: true }, take: 5 }),
        prisma.upiOrder.findMany({ where: { OR: [{ orderRef: s.toUpperCase() }, { bankUtr: s.replace(/\s+/g, '').toUpperCase() }] }, select: { txnId: true } }),
        prisma.withdrawal.findMany({ where: { OR: [{ withdrawalId: s.toUpperCase() }, { providerRef: s }] }, select: { txnId: true } }),
        prisma.utrSubmission.findMany({ where: { utr: s.replace(/\s+/g, '').toUpperCase() }, select: { txnId: true } }),
      ]);
      const txnIds = [...ord, ...wd, ...utr].map((r) => r.txnId).filter((x): x is string => !!x);
      where = { OR: [{ txnId: s }, { reference: s }, { providerReference: s }, { userId: { in: users.map((u) => u.id) } }, { txnId: { in: txnIds } }] };
    }
    const rows = await prisma.transaction.findMany({ where, take: q.limit + 1, ...cursorArgs(q.cursor), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { user: { select: { email: true, paymentId: true } } } });
    const more = rows.length > q.limit; const list = more ? rows.slice(0, q.limit) : rows;
    return ok({ transactions: list.map((t) => ({ ...txDto(t), userId: t.userId, email: t.user.email })), nextCursor: more ? list[list.length - 1]!.id : null });
  });

  app.post<{ Params: { txnId: string } }>('/transactions/:txnId/refund', { preHandler: requirePerm('refunds:write'), ...limit(20) }, async (req) => {
    const b = z.object({ reason, allowSuccessful: z.boolean().default(false) }).parse(req.body);
    const r = await refundDebit({ txnId: req.params.txnId, reason: `admin: ${b.reason}`, allowSuccessful: b.allowSuccessful });
    await adminAudit(req, 'admin.refund', 'Transaction', req.params.txnId, { reason: b.reason, replayed: r.replayed });
    void notify(r.tx.userId, 'refund', 'Refund issued', `₹${money(r.tx.amount).rupees} was refunded to your wallet.`);
    return ok({ refund: txDto(r.tx), replayed: r.replayed });
  });

  // ---------- UTR reconciliation ----------
  app.get('/reconciliation', { preHandler: requirePerm('tx:read') }, async (req) => {
    const q = page.extend({ status: z.enum(['open', 'VERIFIED', 'REJECTED']).default('open') }).parse(req.query);
    const where: Prisma.UtrSubmissionWhereInput = q.status === 'open' ? { status: { in: ['PENDING', 'MANUAL_REVIEW'] } } : { status: q.status };
    const rows = await prisma.utrSubmission.findMany({ where, take: q.limit + 1, ...cursorArgs(q.cursor), orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { user: { select: { email: true, paymentId: true } } } });
    const credits = await prisma.bankCredit.findMany({ where: { utr: { in: rows.map((r) => r.utr) } } });
    const byUtr = new Map(credits.map((c) => [c.utr, c]));
    const more = rows.length > q.limit; const list = more ? rows.slice(0, q.limit) : rows;
    return ok({ cases: list.map((r) => ({ id: r.id, utr: r.utr, amount: money(r.amount), user: r.user, paymentMethod: 'UPI_UTR', provider: byUtr.get(r.utr)?.source ?? null, providerAmount: byUtr.has(r.utr) ? money(byUtr.get(r.utr)!.amount) : null, status: r.status, reason: r.reason, adminNote: r.adminNote, submittedAt: r.createdAt })), nextCursor: more ? list[list.length - 1]!.id : null });
  });
  app.post<{ Params: { id: string } }>('/reconciliation/:id/resolve', { preHandler: requirePerm('reconcile:write'), ...limit(30) }, async (req) => {
    const b = z.object({ action: z.enum(['VERIFY', 'REJECT']), note: reason }).parse(req.body);
    const out = await adminResolveUtr(req.params.id, req.admin!.id, b.action, b.note);
    await adminAudit(req, `admin.reconciliation.${b.action.toLowerCase()}`, 'UtrSubmission', req.params.id, { note: b.note });
    return ok(out);
  });
  app.post<{ Params: { id: string } }>('/reconciliation/:id/note', { preHandler: requirePerm('reconcile:write') }, async (req) => {
    const b = z.object({ note: reason }).parse(req.body);
    await prisma.utrSubmission.update({ where: { id: req.params.id }, data: { adminNote: b.note } });
    await adminAudit(req, 'admin.reconciliation.note', 'UtrSubmission', req.params.id, { note: b.note });
    return ok({ message: 'Saved.' });
  });
  // Enter a verified bank credit by hand (e.g. from a statement). Auto-resolves any waiting submissions.
  app.post('/reconciliation/bank-credits', { preHandler: requirePerm('reconcile:write'), ...limit(30) }, async (req) => {
    const b = z.object({ utr: z.string().min(12).max(40), amount: amountSchema, payeeUpi: z.string().max(100).optional(), note: z.string().max(200).optional() }).parse(req.body);
    const out = await ingestBankCredit({ ...b, source: `admin:${req.admin!.email}` });
    await adminAudit(req, 'admin.bank_credit.entered', 'BankCredit', out.utr);
    return ok(out);
  });

  // ---------- withdrawals ----------
  app.get('/withdrawals', { preHandler: requirePerm('tx:read') }, async (req) => {
    const q = page.extend({ status: z.enum(['open', 'PENDING', 'PROCESSING', 'MANUAL_REVIEW', 'SUCCESSFUL', 'REFUNDED', 'FAILED']).default('open') }).parse(req.query);
    const where: Prisma.WithdrawalWhereInput = q.status === 'open' ? { status: { in: ['PENDING', 'PROCESSING', 'MANUAL_REVIEW', 'FAILED'] } } : { status: q.status };
    const rows = await prisma.withdrawal.findMany({ where, take: q.limit + 1, ...cursorArgs(q.cursor), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { user: { select: { email: true } } } });
    const more = rows.length > q.limit; const list = more ? rows.slice(0, q.limit) : rows;
    return ok({ withdrawals: list.map((w) => ({ ...withdrawalDto(w), destinationFull: w.destination, email: w.user.email, providerRef: w.providerRef, attempts: w.attempts, adminNote: w.adminNote })), nextCursor: more ? list[list.length - 1]!.id : null });
  });
  app.post<{ Params: { id: string } }>('/withdrawals/:id/resolve', { preHandler: requirePerm('withdrawals:write'), ...limit(30) }, async (req) => {
    const b = z.object({ action: z.enum(['MARK_SUCCESS', 'REFUND']), note: reason, providerRef: z.string().max(100).optional() }).parse(req.body);
    const w = await prisma.withdrawal.findUnique({ where: { withdrawalId: req.params.id } });
    if (!w) throw new AppError('NOT_FOUND', 'Withdrawal not found.', 404);
    if (!['PROCESSING', 'MANUAL_REVIEW', 'FAILED'].includes(w.status)) throw new AppError('ALREADY_RESOLVED', 'This withdrawal is already settled.', 409);
    await prisma.withdrawal.update({ where: { id: w.id }, data: { adminNote: b.note } });
    if (b.action === 'MARK_SUCCESS') await finalizeSuccess(w, b.providerRef); else await finalizeFailure(w, `admin: ${b.note}`);
    await adminAudit(req, `admin.withdrawal.${b.action.toLowerCase()}`, 'Withdrawal', w.withdrawalId, { note: b.note });
    return ok({ withdrawal: withdrawalDto(await prisma.withdrawal.findUniqueOrThrow({ where: { id: w.id } })) });
  });

  // ---------- "Pay With UPI" deposit orders & bank credits ----------
  app.get('/deposits', { preHandler: requirePerm('tx:read') }, async (req) => {
    const q = page.extend({ status: z.enum(['all', 'CREATED', 'PAID', 'EXPIRED', 'CANCELLED']).default('all') }).parse(req.query);
    const rows = await prisma.upiOrder.findMany({ where: q.status === 'all' ? {} : { status: q.status }, take: q.limit + 1, ...cursorArgs(q.cursor), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { user: { select: { email: true, paymentId: true } } } });
    const more = rows.length > q.limit; const list = more ? rows.slice(0, q.limit) : rows;
    return ok({ orders: list.map((o) => ({ id: o.id, ref: o.orderRef, amount: money(o.amount), status: o.status, email: o.user.email, paymentId: o.user.paymentId, txnId: o.txnId, bankUtr: o.bankUtr, createdAt: o.createdAt, paidAt: o.paidAt })), nextCursor: more ? list[list.length - 1]!.id : null });
  });
  app.post<{ Params: { ref: string } }>('/deposits/:ref/settle', { preHandler: requirePerm('reconcile:write'), ...limit(30) }, async (req) => {
    const b = z.object({ transactionId: z.string().min(12).max(40), note: reason }).parse(req.body);
    const o = await adminSettleOrder(req.params.ref, b.transactionId, req.admin!.email);
    await adminAudit(req, 'admin.deposit.settled', 'UpiOrder', o.orderRef, { note: b.note });
    return ok({ status: o.status, txnId: o.txnId });
  });
  app.post<{ Params: { ref: string } }>('/deposits/:ref/cancel', { preHandler: requirePerm('reconcile:write'), ...limit(30) }, async (req) => {
    const r = await prisma.upiOrder.updateMany({ where: { orderRef: req.params.ref.toUpperCase(), status: 'CREATED' }, data: { status: 'CANCELLED' } });
    await adminAudit(req, 'admin.deposit.cancelled', 'UpiOrder', req.params.ref);
    return ok({ cancelled: r.count === 1 });
  });
  app.get('/bank-credits', { preHandler: requirePerm('tx:read') }, async () => {
    const rows = await prisma.bankCredit.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    const used = await prisma.transaction.findMany({ where: { provider: 'UPI_UTR', providerReference: { in: rows.map((r) => r.utr) } }, select: { providerReference: true } });
    const set = new Set(used.map((u) => u.providerReference));
    return ok({ credits: rows.map((r) => ({ id: r.id, utr: r.utr, amount: money(r.amount), payeeUpi: r.payeeUpi, note: r.note, source: r.source, receivedAt: r.receivedAt, credited: set.has(r.utr) })) });
  });

  // ---------- settings ----------
  const MATCH = z.object({ path: z.string().max(60), equals: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).max(20) });
  const payoutSchema = z.object({
    method: z.enum(['GET', 'POST']), url: z.string().max(500), headers: z.record(z.string().max(300)).default({}), body: z.string().max(2000).optional(), timeoutMs: z.number().int().min(2000).max(60_000).default(15_000),
    success: MATCH, failure: MATCH, referencePath: z.string().max(60).optional(),
    status: z.object({ method: z.enum(['GET', 'POST']), url: z.string().max(500), headers: z.record(z.string().max(300)).optional(), body: z.string().max(2000).optional(), success: MATCH, failure: MATCH, referencePath: z.string().max(60).optional() }).optional(),
    secrets: z.object({ token: z.string().max(300).optional(), secret: z.string().max(300).optional() }).default({}),
  });

  app.get('/settings', { preHandler: requirePerm('settings:read') }, async () => {
    const [slabs, dep, wd] = await Promise.all([getActiveSlabs(), getDepositLimits(), getWithdrawRules()]);
    const upi = upiConfig(), po = payoutConfig(), autoMatch = await getAutoMatchByAmount();
    return ok({
      tax: slabs.map((s) => ({ upToPaise: s.upToPaise?.toString() ?? null, rateBps: s.rateBps })),
      deposit: { minPaise: dep.min.toString(), maxPaise: dep.max.toString() },
      withdraw: { minPaise: wd.min.toString(), maxPaise: wd.max.toString(), flatFeePaise: wd.flatFee.toString(), feeBps: wd.feeBps },
      upi: { upiId: upi?.upiId ?? '', name: upi?.name ?? '', instructions: upi?.instructions ?? '', autoMatchByAmount: autoMatch },
      site: siteConfig(),
      payout: po ? { ...po, secrets: { token: maskSecret(po.secrets.token), secret: maskSecret(po.secrets.secret) } } : null,
    });
  });

  const put = <T extends z.ZodTypeAny>(section: string, schema: T, apply: (b: z.infer<T>) => Promise<void>) =>
    app.put(`/settings/${section}`, { preHandler: requirePerm('settings:write'), ...limit(20) }, async (req) => {
      await apply(schema.parse(req.body));
      await adminAudit(req, `admin.settings.${section}`, 'Setting', section); // values are never logged
      return ok({ saved: true });
    });
  put('tax', z.object({ slabs: z.array(z.object({ upToPaise: z.string().regex(/^\d+$/).nullable(), rateBps: z.number().int().min(0).max(10_000) })).min(1).max(10) }), async (b) => {
    if (!parseSlabs(b.slabs)) throw new AppError('INVALID_TAX', 'Slabs must ascend and end with an open-ended slab.', 422);
    await saveSetting('tax.slabs', b.slabs); // old transactions keep the rate they were charged
  });
  put('deposit', z.object({ minPaise: z.string().regex(/^\d+$/), maxPaise: z.string().regex(/^\d+$/) }), async (b) => {
    if (BigInt(b.minPaise) < 100n || BigInt(b.maxPaise) < BigInt(b.minPaise)) throw new AppError('INVALID_LIMITS', 'Invalid limits.', 422);
    await saveSetting('deposit.limits', b);
  });
  put('withdraw', z.object({ minPaise: z.string().regex(/^\d+$/), maxPaise: z.string().regex(/^\d+$/), flatFeePaise: z.string().regex(/^\d+$/).default('0'), feeBps: z.number().int().min(0).max(1000).default(0) }), (b) => saveSetting('withdraw.rules', b));
  put('upi', z.object({ upiId: z.string().regex(/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,31}$/), name: z.string().min(1).max(60), instructions: z.string().max(500).optional(), autoMatchByAmount: z.boolean().default(true) }), (b) => saveSetting('upi', b));
  const tone = z.enum(['info', 'warn', 'success']);
  put('site', z.object({
    name: z.string().trim().min(1).max(40), tagline: z.string().trim().max(120).default(''), supportEmail: z.string().trim().max(120).default(''), supportTelegram: z.string().trim().max(60).default(''),
    announcement: z.object({ enabled: z.boolean(), text: z.string().trim().max(300), tone }), maintenance: z.object({ enabled: z.boolean(), message: z.string().trim().max(300) }),
    features: z.object({ registrations: z.boolean(), deposits: z.boolean(), withdrawals: z.boolean(), transfers: z.boolean(), payments: z.boolean(), api: z.boolean() }),
  }), (b) => saveSetting('site', b));
  put('payout', payoutSchema, async (b) => {
    const old = (await prisma.systemSetting.findUnique({ where: { key: 'payout' } }))?.value as any;
    const secretsEnc = { token: b.secrets.token ? seal(b.secrets.token) : old?.secretsEnc?.token, secret: b.secrets.secret ? seal(b.secrets.secret) : old?.secretsEnc?.secret };
    try { previewRequest({ ...b, secrets: {} } as PayoutConfig, { reference: 'WDR-TEST0000', destination: 'test@upi', amountPaise: 1000n }); } catch (e) { throw new AppError('INVALID_PAYOUT_CONFIG', (e as Error).message, 422); }
    const { secrets: _drop, ...rest } = b;
    await saveSetting('payout', { ...rest, secretsEnc });
  });
  // Shows exactly what would be sent (secrets masked). Sends nothing, so no real money is at risk.
  app.post('/settings/payout/test', { preHandler: requirePerm('settings:write'), ...limit(20) }, async (req) => {
    const b = payoutSchema.partial({ secrets: true, headers: true, timeoutMs: true }).optional().parse(req.body);
    const cfg = (b ? { ...payoutConfig(), ...b } : payoutConfig()) as PayoutConfig | null;
    if (!cfg) throw new AppError('NOT_CONFIGURED', 'No payout provider configured.', 404);
    try { return ok({ preview: previewRequest({ ...cfg, headers: cfg.headers ?? {}, secrets: cfg.secrets ?? {} }, { reference: 'WDR-TEST0000', destination: 'test@upi', amountPaise: 1000n }) }); }
    catch (e) { throw new AppError('INVALID_PAYOUT_CONFIG', (e as Error).message, 422); }
  });

  // ---------- logs, risk, api, admins ----------
  app.get('/audit-logs', { preHandler: requirePerm('audit:read') }, async (req) => {
    const q = page.extend({ actor: z.string().max(80).optional(), action: z.string().max(80).optional() }).parse(req.query);
    const rows = await prisma.auditLog.findMany({ where: { ...(q.actor ? { actorId: q.actor } : {}), ...(q.action ? { action: { startsWith: q.action } } : {}) }, take: q.limit + 1, ...cursorArgs(q.cursor), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const more = rows.length > q.limit; const list = more ? rows.slice(0, q.limit) : rows;
    return ok({ logs: list, nextCursor: more ? list[list.length - 1]!.id : null });
  });
  app.get('/webhook-logs', { preHandler: requirePerm('tx:read') }, async () => {
    const [events, deliveries] = await Promise.all([prisma.webhookEvent.findMany({ orderBy: { processedAt: 'desc' }, take: 50 }), prisma.webhookDelivery.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, userId: true, event: true, status: true, attempts: true, lastStatus: true, lastError: true, createdAt: true } })]);
    return ok({ providerEvents: events, merchantDeliveries: deliveries });
  });
  app.get('/risk-flags', { preHandler: requirePerm('users:read') }, async () => ok({ flags: await prisma.riskFlag.findMany({ where: { status: 'OPEN' }, orderBy: { createdAt: 'desc' }, take: 100, include: { user: { select: { email: true } } } }) }));
  app.post<{ Params: { id: string } }>('/risk-flags/:id', { preHandler: requirePerm('users:write') }, async (req) => {
    const b = z.object({ status: z.enum(['REVIEWED', 'DISMISSED']) }).parse(req.body);
    await prisma.riskFlag.update({ where: { id: req.params.id }, data: { status: b.status } });
    await adminAudit(req, 'admin.risk_flag.' + b.status.toLowerCase(), 'RiskFlag', req.params.id);
    return ok({ message: 'Updated.' });
  });
  app.get('/api-tokens', { preHandler: requirePerm('users:read') }, async () => {
    const rows = await prisma.apiToken.findMany({ where: { status: 'ACTIVE' }, orderBy: { lastUsedAt: 'desc' }, take: 100, include: { user: { select: { email: true } } } });
    return ok({ tokens: rows.map((t) => ({ id: t.id, prefix: t.prefix, email: t.user.email, scopes: t.scopes, lastUsedAt: t.lastUsedAt, createdAt: t.createdAt })) });
  });
  app.post<{ Params: { id: string } }>('/api-tokens/:id/revoke', { preHandler: requirePerm('api:write') }, async (req) => {
    await prisma.apiToken.updateMany({ where: { id: req.params.id, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } });
    await adminAudit(req, 'admin.api_token.revoked', 'ApiToken', req.params.id);
    return ok({ message: 'Revoked.' });
  });
  app.get('/admins', { preHandler: requirePerm('admins:write') }, async () => ok({ admins: (await prisma.admin.findMany({ orderBy: { createdAt: 'asc' } })).map((a) => ({ id: a.id, email: a.email, role: a.role, active: a.active })) }));
  app.post('/admins', { preHandler: requirePerm('admins:write'), ...limit(10) }, async (req) => {
    const b = z.object({ email: z.string().email(), password: password.refine((p) => p.length >= 12, 'Admin passwords need 12+ characters.'), role: z.enum(['SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'READ_ONLY']) }).parse(req.body);
    const a = await prisma.admin.create({ data: { email: b.email.toLowerCase(), passwordHash: await hashSecret(b.password), role: b.role } }).catch(() => { throw new AppError('ADMIN_EXISTS', 'An admin with this email already exists.', 409); });
    await adminAudit(req, 'admin.admin.created', 'Admin', a.id, { role: b.role });
    return ok({ id: a.id });
  });
  app.post<{ Params: { id: string } }>('/admins/:id/active', { preHandler: requirePerm('admins:write') }, async (req) => {
    const b = z.object({ active: z.boolean() }).parse(req.body);
    if (req.params.id === req.admin!.id) throw new AppError('INVALID', 'You cannot change your own status.', 400);
    await prisma.admin.update({ where: { id: req.params.id }, data: { active: b.active } });
    if (!b.active) await prisma.adminSession.updateMany({ where: { adminId: req.params.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await adminAudit(req, 'admin.admin.active', 'Admin', req.params.id, { active: b.active });
    return ok({ message: 'Updated.' });
  });
  void sha256;
}
