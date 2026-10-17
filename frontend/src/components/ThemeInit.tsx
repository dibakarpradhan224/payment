'use client';
import { useEffect } from 'react';
import { applyTheme, getTheme } from '@/lib/theme';
/** Re-applies the saved theme as soon as the app loads. */
export function ThemeInit() { useEffect(() => { applyTheme(getTheme()); }, []); return null; }
