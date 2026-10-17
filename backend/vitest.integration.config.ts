import { defineConfig } from 'vitest/config';
// Needs a REAL database: use a separate Supabase project / branch, never production.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    env: {
      APP_URL: 'http://localhost:3000',
      SESSION_SECRET: 's'.repeat(40),
      OTP_PEPPER: 'p'.repeat(40),
      BANK_WEBHOOK_SECRET: 'bank_webhook_secret_123456',
      UPI_ID: 'merchant@upi',
      ADMIN_EMAIL: 'admin@test.com',
      ADMIN_SECRET: 'a-long-admin-password-123',
    },
  },
});
