'use client';
/** Dependency-free responsive SVG bar chart. */
export function BarChart({ data, color = '#ff9f1c', format = (n: number) => String(n) }: { data: { label: string; value: number }[]; color?: string; format?: (n: number) => string }) {
  if (!data.length) return <p className="py-8 text-center text-sm text-zinc-500">No data yet.</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const w = 100 / data.length;
  return (
    <svg viewBox="0 0 100 48" className="h-44 w-full" preserveAspectRatio="none" role="img">
      {data.map((d, i) => {
        const h = (d.value / max) * 38;
        return (
          <g key={i}>
            <rect x={i * w + w * 0.15} y={42 - h} width={w * 0.7} height={Math.max(h, 0.4)} rx="0.8" fill={color} opacity={0.9}><title>{`${d.label}: ${format(d.value)}`}</title></rect>
            {data.length <= 15 && <text x={i * w + w / 2} y="47" textAnchor="middle" fontSize="2.6" fill="#71717a">{d.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}
