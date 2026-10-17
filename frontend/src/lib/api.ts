export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public extra?: any) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; idem?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.idem ? { 'Idempotency-Key': opts.idem } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK', 'Network error. Check your connection and try again.', 0);
  }
  const j = await res.json().catch(() => null);
  if (!j || j.success === false || !res.ok) {
    throw new ApiError(j?.error?.code ?? 'ERROR', j?.error?.message ?? 'Something went wrong.', res.status, j?.error);
  }
  return j.data as T;
}

/** One key per user intent: reuse it for retries of the SAME submit so the server never repeats the action. */
export const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const W = '/web/v1';
export const A = '/admin/v1';
