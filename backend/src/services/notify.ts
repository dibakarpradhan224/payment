import { prisma } from '../lib/prisma.js';
import { sendMail } from './mail.js';
import { sendMessage } from '../telegram/api.js';

/** In-app + email (if enabled) + Telegram (if linked). Never throws: a failed notification must not fail a payment. */
export async function notify(userId: string, type: string, title: string, body: string) {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, include: { telegramLink: true } });
    if (!u) return;
    await prisma.notification.create({ data: { userId, type, title, body } });
    if (u.notifyEmail) void sendMail(u.email, title, body).catch(() => {});
    if (u.notifyTelegram && u.telegramLink) {
      const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
      void sendMessage(u.telegramLink.telegramId.toString(), `<b>${esc(title)}</b>\n${esc(body)}`).catch(() => {});
    }
  } catch (e) {
    console.error('notify.failed', (e as Error).message);
  }
}
