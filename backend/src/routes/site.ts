import type { FastifyInstance } from 'fastify';
import { ok } from '../lib/errors.js';
import { siteConfig } from '../services/settings.js';

/** Public: what the website needs to show the name, announcement banner and maintenance / feature switches. */
export async function siteRoutes(app: FastifyInstance) {
  app.get('/site', async () => {
    const s = siteConfig();
    return ok({
      name: s.name, tagline: s.tagline, supportEmail: s.supportEmail, supportTelegram: s.supportTelegram,
      announcement: s.announcement.enabled && s.announcement.text ? { text: s.announcement.text, tone: s.announcement.tone } : null,
      maintenance: s.maintenance.enabled ? { message: s.maintenance.message } : null,
      features: s.features,
    });
  });
}
