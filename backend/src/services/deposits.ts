import { AppError } from '../lib/errors.js';
import { money, formatPaise } from '../lib/money.js';
import { getDepositLimits } from './settings.js';
import { calculateTax } from './tax.js';
import { getActiveSlabs } from './taxSettings.js';

/** Server-side limits + tax. Nothing from the client is trusted. */
export async function quoteDeposit(amount: bigint) {
  const lim = await getDepositLimits();
  if (amount < lim.min || amount > lim.max) {
    throw new AppError('INVALID_AMOUNT', `Deposit must be between ₹${formatPaise(lim.min)} and ₹${formatPaise(lim.max)}.`, 422);
  }
  const t = calculateTax(amount, await getActiveSlabs());
  return { gross: money(amount), tax: money(t.tax), taxRatePercent: t.rateBps / 100, net: money(t.net) };
}
