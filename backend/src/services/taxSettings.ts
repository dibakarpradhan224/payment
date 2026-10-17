import { prisma } from '../lib/prisma.js';
import { DEFAULT_SLABS, type Slab } from './tax.js';

export function parseSlabs(raw: unknown): Slab[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  try {
    const slabs = raw.map((r: any) => ({
      upToPaise: r.upToPaise === null ? null : BigInt(r.upToPaise),
      rateBps: Number(r.rateBps),
    }));
    const ok =
      slabs.every((s, i) => Number.isInteger(s.rateBps) && s.rateBps >= 0 && s.rateBps <= 10000 && (s.upToPaise === null ? i === slabs.length - 1 : i < slabs.length - 1)) &&
      slabs.every((s, i) => i === 0 || (s.upToPaise === null ? true : s.upToPaise > (slabs[i - 1]!.upToPaise ?? 0n)));
    return ok ? slabs : null;
  } catch {
    return null;
  }
}


/** Admin-editable via SystemSetting 'tax.slabs'; falls back to the defaults. Past transactions keep the rate they were charged. */
export async function getActiveSlabs(): Promise<Slab[]> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'tax.slabs' } });
  return (row && parseSlabs(row.value)) || DEFAULT_SLABS;
}
