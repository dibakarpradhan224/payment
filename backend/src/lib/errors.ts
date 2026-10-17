export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const ok = <T>(data: T) => ({ success: true as const, data });
