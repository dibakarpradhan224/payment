import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    env: { DATABASE_URL: 'postgresql://x', APP_URL: 'http://localhost:3000', SESSION_SECRET: 's'.repeat(40), OTP_PEPPER: 'p'.repeat(40) },
  },
});
