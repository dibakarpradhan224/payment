import nodemailer from 'nodemailer';
import { env, isProd } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    })
  : null;

export const BRAND = 'Cafin Pay';

async function deliver(opts: Parameters<NonNullable<typeof transport>['sendMail']>[0]) {
  try { await transport!.sendMail(opts); }
  catch (e: any) {
    console.error('mail.send_failed', e?.code ?? '', String(e?.message ?? '').slice(0, 200)); // real reason stays in the server log
    throw new AppError('EMAIL_FAILED', isProd ? 'We could not send the email right now. Please try again.' : 'Could not send the email. Check SMTP_HOST, SMTP_USER and SMTP_PASSWORD in backend/.env (see the backend terminal for the reason).', 502);
  }
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Branded email shell: coloured header with the name, centred content, grey footer. Inline styles + tables so Gmail/Outlook render it. */
export function emailLayout(inner: string): string {
  const host = (() => { try { return new URL(env.APP_URL).host; } catch { return env.APP_URL; } })();
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border:1px solid #eeeeee;border-radius:12px;overflow:hidden;">
<tr><td align="center" style="background:#0c0c10;padding:34px 20px;"><span style="font-size:28px;font-weight:bold;color:#ffffff;letter-spacing:.3px;">Cafin <span style="color:#ff9f1c;">Pay</span></span></td></tr>
<tr><td align="center" style="padding:46px 28px 38px;">${inner}</td></tr>
<tr><td align="center" style="background:#f4f4f4;padding:28px 20px;font-size:13px;color:#777777;">&copy; ${new Date().getFullYear()} ${BRAND}. All rights reserved.<br><br><a href="${esc(env.APP_URL)}" style="color:#e8860c;text-decoration:none;">${esc(host)}</a></td></tr>
</table></td></tr></table></body></html>`;
}

const TITLES: Record<string, { subject: string; heading: string }> = {
  REGISTER: { subject: `Your ${BRAND} verification code`, heading: `Your OTP code to register with ${BRAND}` },
  PASSWORD_RESET: { subject: `Reset your ${BRAND} password`, heading: `Your OTP code to reset your ${BRAND} password` },
  PIN_RESET: { subject: `Reset your ${BRAND} PIN`, heading: `Your OTP code to reset your transaction PIN` },
};

export async function sendOtpEmail(to: string, purpose: string, code: string, ttlMinutes: number) {
  if (!transport) {
    if (isProd) throw new Error('SMTP is not configured');
    // Development convenience only. Never reachable in production.
    console.warn(`[dev-mail] ${purpose} OTP for ${to}: ${code}`);
    return;
  }
  const t = TITLES[purpose] ?? { subject: `Your ${BRAND} code`, heading: `Your ${BRAND} verification code` };
  const html = emailLayout(`
<h1 style="font-size:22px;color:#222222;margin:0 0 28px;">${esc(t.heading)}</h1>
<p style="font-size:18px;color:#444444;margin:0 0 22px;">Use this One-Time Password (OTP):</p>
<p style="font-size:42px;font-weight:bold;letter-spacing:10px;color:#e8860c;margin:0 0 26px;">${esc(code)}</p>
<p style="font-size:18px;color:#444444;margin:0 0 22px;">This OTP is valid for ${ttlMinutes} minutes only.</p>
<p style="font-size:15px;color:#666666;margin:0;">Do not share this OTP with anyone. ${BRAND} will never ask for your OTP.</p>`);
  await deliver({
    from: env.SMTP_FROM, to, subject: t.subject, html,
    text: `${t.heading}\n\nYour OTP: ${code}\nValid for ${ttlMinutes} minutes only.\n\nDo not share this OTP with anyone. ${BRAND} will never ask for your OTP.`,
  });
}

/** Plain notifications get the same branded look. */
export async function sendMail(to: string, subject: string, text: string, html?: string) {
  if (!transport) { if (!isProd) console.warn(`[dev-mail] to=${to} subject=${subject}`); return; }
  const body = html ?? emailLayout(`<h1 style="font-size:22px;color:#222222;margin:0 0 22px;">${esc(subject)}</h1><p style="font-size:17px;line-height:1.5;color:#444444;margin:0;">${esc(text).replace(/\n/g, '<br>')}</p>`);
  await deliver({ from: env.SMTP_FROM, to, subject, text, html: body });
}
