'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const alive = useRef(true);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try { const d = await api<T>(path); if (alive.current) { setData(d); setError(null); } }
    catch (e) { if (alive.current) setError(e as ApiError); }
    finally { if (alive.current) setLoading(false); }
  }, [path]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: load, setData };
}

export function useDebounced<T>(v: T, ms = 400) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
