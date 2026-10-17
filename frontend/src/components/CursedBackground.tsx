/** Decorative background: slow-drifting energy orbs and rising embers. Deterministic (no randomness) so it never causes hydration mismatches. */
export function CursedBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="orb orb-a" /><div className="orb orb-b" /><div className="orb orb-c" />
      {Array.from({ length: 18 }, (_, i) => (
        <span key={i} className="ember" style={{ left: `${(i * 37 + 7) % 100}%`, width: 2 + (i % 3), height: 2 + (i % 3), animationDelay: `${(i * 1.3) % 11}s`, animationDuration: `${10 + (i % 6) * 2.5}s` }} />
      ))}
    </div>
  );
}
