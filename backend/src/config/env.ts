import { z } from 'zod';

// Node does not read .env by itself (Prisma does, the app did not). Load it here; real environment variables still win.
try { process.loadEnvFile('.env'); } catch { /* no .env file: rely on real environment variables */ }

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  APP_URL: z.string().url(),
  EXTRA_ORIGINS: z.string().default(''),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  SESSION_SECRET: z.string().min(32),
  OTP_PEPPER: z.string().min(32),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  // HTTPS email APIs (use one when the host blocks SMTP ports, e.g. Railway trial/hobby plans)
  BREVO_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  BANK_WEBHOOK_SECRET: z.string().min(16).optional(),
  UPI_ID: z.string().optional(),
  UPI_NAME: z.string().default('Gateway'),
  SETTINGS_KEY: z.string().min(32).optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_SECRET: z.string().min(12).optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  PAYOUT_API_URL: z.string().optional(),
  PAYOUT_API_TOKEN: z.string().optional(),
  PAYOUT_API_SECRET: z.string().optional(),
  RUN_JOBS: z.enum(['true', 'false']).default('true'),
  SMTP_FROM: z.string().default('Cafin Pay <no-reply@localhost>'),
});

// A line like `BANK_WEBHOOK_SECRET=` (empty) means "not set", not "an empty secret".
const parsed = schema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== '')));
if (!parsed.success) {
  // Print variable names only, never values.
  const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  console.error(`Invalid environment configuration: ${names}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const allowedOrigins = [env.APP_URL, ...env.EXTRA_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)]
  .map((o) => o.replace(/\/$/, ''));
