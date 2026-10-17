import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const mobile = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91)(?=\d{10}$)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit Indian mobile number.');
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain a letter and a number.');
/** Display name other users see. No '@' so it can never be mistaken for (or leak) an email address. */
export const nameSchema = z.string().trim().min(2, 'Name must be at least 2 characters.').max(60, 'Name is too long.')
  .regex(/^[\p{L}\p{N} .'-]+$/u, "Use letters, numbers, spaces and . ' - only.");
export const pin = z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits.');
const otp = z.string().regex(/^\d{6}$/, 'OTP must be 6 digits.');

const matches = <T extends Record<string, any>>(a: keyof T, b: keyof T, msg: string) =>
  (v: T, ctx: z.RefinementCtx) => {
    if (v[a] !== v[b]) ctx.addIssue({ code: 'custom', path: [b as string], message: msg });
  };

export const registerStart = z
  .object({ name: nameSchema.optional(), mobile, email, password, confirmPassword: z.string() })
  .superRefine(matches('password', 'confirmPassword', 'Passwords do not match.'));
export const registerVerify = z.object({ email, otp });
export const login = z.object({ email, password: z.string().min(1).max(128), remember: z.boolean().optional() });
export const forgot = z.object({ email });
export const verifyResetOtp = z.object({ email, otp });
export const resetPassword = z
  .object({ resetToken: z.string().min(20), newPassword: password, confirmPassword: z.string() })
  .superRefine(matches('newPassword', 'confirmPassword', 'Passwords do not match.'));
export const setPin = z.object({ pin, confirmPin: pin }).superRefine(matches('pin', 'confirmPin', 'PINs do not match.'));
export const changePin = z
  .object({ oldPin: pin, pin, confirmPin: pin })
  .superRefine(matches('pin', 'confirmPin', 'PINs do not match.'));
export const pinVerifyOtp = z.object({ otp });
export const resetPin = z
  .object({ resetToken: z.string().min(20), pin, confirmPin: pin })
  .superRefine(matches('pin', 'confirmPin', 'PINs do not match.'));
