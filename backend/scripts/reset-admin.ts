// Usage (from backend/):  npm run admin:reset
// Makes the Super Admin in the database match ADMIN_EMAIL / ADMIN_SECRET from .env, clears any lockout, signs out old admin sessions.
import { prisma } from '../src/lib/prisma.js';
import { env } from '../src/config/env.js';
import { hashSecret } from '../src/lib/crypto.js';

if (!env.ADMIN_EMAIL || !env.ADMIN_SECRET) { console.error('Set ADMIN_EMAIL and ADMIN_SECRET (12+ characters) in backend/.env first.'); process.exit(1); }
const email = env.ADMIN_EMAIL.toLowerCase();
const passwordHash = await hashSecret(env.ADMIN_SECRET);
await prisma.admin.upsert({
  where: { email },
  update: { passwordHash, active: true, role: 'SUPER_ADMIN', failedLoginAttempts: 0, lockedUntil: null },
  create: { email, passwordHash, role: 'SUPER_ADMIN' },
});
await prisma.adminSession.updateMany({ where: { admin: { email }, revokedAt: null }, data: { revokedAt: new Date() } });
console.log(`Admin ready: ${email}\nPassword = the ADMIN_SECRET currently in .env (${env.ADMIN_SECRET.length} characters).`);
await prisma.$disconnect();
