import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { open, seal } from '../lib/secretBox.js';
import { AppError } from '../lib/errors.js';
import type { PayoutConfig } from '../providers/payout.js';

/**
 * Runtime settings: admin-edited values (DB, secrets encrypted) override env defaults.
 * Kept in an in-memory cache that refreshSettings() reloads (startup, after admin edits, every minute).
 */
export type FeatureName = 'registrations' | 'deposits' | 'withdrawals' | 'transfers' | 'payments' | 'api';
export interface SiteSettings {
  name: string; tagline: string; supportEmail: string; supportTelegram: string;
  announcement: { enabled: boolean; text: string; tone: 'info' | 'warn' | 'success' };
  maintenance: { enabled: boolean; message: string };
  features: Record<FeatureName, boolean>;
}
export const FEATURE_LABELS: Record<FeatureName, string> = {
  registrations: 'New sign-ups', deposits: 'Add money', withdrawals: 'Withdrawals', transfers: 'Wallet transfers', payments: 'Payment requests / QR payments', api: 'Payout & Merchant API',
};
export const DEFAULT_SITE: SiteSettings = {
  name: 'Cafin Pay', tagline: '', supportEmail: '', supportTelegram: '',
  announcement: { enabled: false, text: '', tone: 'info' },
  maintenance: { enabled: false, message: 'We are performing maintenance. Please try again shortly.' },
  features: { registrations: true, deposits: true, withdrawals: true, transfers: true, payments: true, api: true },
};

interface Cache {
  upi?: { upiId: string; name: string; instructions?: string };
  payout?: PayoutConfig;
  site?: SiteSettings;
}
let cache: Cache = {};

const row = (key: string) => prisma.systemSetting.findUnique({ where: { key } });
const tryOpen = (v?: string) => { try { return v ? open(v) : undefined; } catch { return undefined; } };

export async function refreshSettings() {
  const [upi, po, site] = await Promise.all([row('upi'), row('payout'), row('site')]);
  const next: Cache = {};
  next.site = mergeSite(site?.value as Partial<SiteSettings> | undefined);
  const u = upi?.value as any;
  if (u?.upiId) next.upi = { upiId: u.upiId, name: u.name ?? 'Gateway', instructions: u.instructions };
  const p = po?.value as any;
  if (p?.url) next.payout = { ...p, secrets: { token: tryOpen(p.secretsEnc?.token), secret: tryOpen(p.secretsEnc?.secret) } } as PayoutConfig;
  cache = next;
}

function mergeSite(v?: Partial<SiteSettings>): SiteSettings {
  const d = DEFAULT_SITE;
  return {
    name: v?.name || d.name, tagline: v?.tagline ?? d.tagline, supportEmail: v?.supportEmail ?? d.supportEmail, supportTelegram: v?.supportTelegram ?? d.supportTelegram,
    announcement: { ...d.announcement, ...(v?.announcement ?? {}) },
    maintenance: { ...d.maintenance, ...(v?.maintenance ?? {}) },
    features: { ...d.features, ...(v?.features ?? {}) },
  };
}
export const siteConfig = (): SiteSettings => cache.site ?? DEFAULT_SITE;

/** Admin on/off switches. Maintenance mode blocks every money feature; individual switches block one feature. */
export function assertFeature(name: FeatureName) {
  const s = siteConfig();
  if (s.maintenance.enabled) throw new AppError('MAINTENANCE', s.maintenance.message || 'We are performing maintenance. Please try again shortly.', 503);
  if (!s.features[name]) throw new AppError('FEATURE_DISABLED', `${FEATURE_LABELS[name]} ${name === 'registrations' ? 'are' : 'is'} temporarily turned off. Please try again later.`, 503);
}

export async function saveSetting(key: string, value: unknown) {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  await refreshSettings();
}
export const sealed = seal;

export async function getDepositLimits() {
  const upi = (await row('upi'))?.value as { minPaise?: string; maxPaise?: string } | undefined;
  const v = ((await row('deposit.limits'))?.value ?? upi) as { minPaise?: string; maxPaise?: string } | undefined;
  try {
    return { min: v?.minPaise ? BigInt(v.minPaise) : 100n, max: v?.maxPaise ? BigInt(v.maxPaise) : 10_000_000n };
  } catch {
    return { min: 100n, max: 10_000_000n };
  }
}

/** ₹15. Applies whenever the admin has not saved a different minimum. */
export const DEFAULT_MIN_WITHDRAW = 1500n;

export async function getWithdrawRules() {
  const v = (await row('withdraw.rules'))?.value as { minPaise?: string; maxPaise?: string; flatFeePaise?: string; feeBps?: number } | undefined;
  const big = (x: string | undefined, d: bigint) => { try { return x ? BigInt(x) : d; } catch { return d; } };
  return { min: big(v?.minPaise, DEFAULT_MIN_WITHDRAW), max: big(v?.maxPaise, 5_000_000n), flatFee: big(v?.flatFeePaise, 0n), feeBps: v?.feeBps ?? 0 }; // ₹15 .. ₹50,000
}

/** When a bank credit has no order reference in its note, credit the one open order with exactly that amount (only if there is exactly one). */
export async function getAutoMatchByAmount(): Promise<boolean> {
  const v = (await row('upi'))?.value as { autoMatchByAmount?: boolean } | undefined;
  return v?.autoMatchByAmount !== false;
}

export const upiConfig = () => cache.upi ?? (env.UPI_ID ? { upiId: env.UPI_ID, name: env.UPI_NAME, instructions: undefined } : null);

export const payoutConfig = (): PayoutConfig | null =>
  cache.payout ??
  (env.PAYOUT_API_URL
    ? ({
        method: 'GET', url: env.PAYOUT_API_URL, headers: {}, timeoutMs: 15000,
        success: { path: 'status', equals: ['success', 'SUCCESS', 'Success', true, 1, '1'] },
        failure: { path: 'status', equals: ['failed', 'FAILED', 'failure', 'error', 'ERROR', false, 0, '0'] },
        referencePath: 'txn_id',
        secrets: { token: env.PAYOUT_API_TOKEN, secret: env.PAYOUT_API_SECRET },
      } as PayoutConfig)
    : null);
