import { describe, expect, it } from 'vitest';
import * as v from '../../src/validators/auth.js';

describe('validators', () => {
  const base = { mobile: '+91 98765-43210', email: ' User@Gmail.com ', password: 'Passw0rdX', confirmPassword: 'Passw0rdX' };
  it('normalises mobile and email', () => {
    const r = v.registerStart.parse(base);
    expect(r.mobile).toBe('9876543210');
    expect(r.email).toBe('user@gmail.com');
  });
  it('rejects mismatched passwords', () => {
    expect(() => v.registerStart.parse({ ...base, confirmPassword: 'other1234' })).toThrow();
  });
  it('rejects weak passwords', () => {
    expect(() => v.password.parse('onlyletters')).toThrow();
    expect(() => v.password.parse('12345678')).toThrow();
  });
  it('requires exactly 4 digit PIN and matching confirm', () => {
    expect(() => v.setPin.parse({ pin: '123', confirmPin: '123' })).toThrow();
    expect(() => v.setPin.parse({ pin: '1234', confirmPin: '1235' })).toThrow();
    expect(v.setPin.parse({ pin: '1234', confirmPin: '1234' }).pin).toBe('1234');
  });
  it('requires 6 digit OTP', () => {
    expect(() => v.registerVerify.parse({ email: 'a@b.co', otp: '12345' })).toThrow();
  });
});
