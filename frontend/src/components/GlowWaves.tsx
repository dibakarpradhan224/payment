/** Decorative glowing orange waves (pure SVG, no image files). */
export function GlowWaves() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="gw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: 'rgb(var(--g300))' }} stopOpacity=".95" /><stop offset=".55" style={{ stopColor: 'rgb(var(--g500))' }} /><stop offset="1" style={{ stopColor: 'rgb(var(--g600))' }} stopOpacity=".2" /></linearGradient>
        <radialGradient id="gr" cx=".85" cy=".78" r=".6"><stop offset="0" style={{ stopColor: 'rgb(var(--g500))' }} stopOpacity=".38" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
        <filter id="gb" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      <rect width="400" height="800" fill="url(#gr)" />
      <g fill="none" stroke="url(#gw)" strokeLinecap="round">
        <g filter="url(#gb)" strokeWidth="3">
          <path d="M-40 70 C 80 20, 150 200, 300 120 S 430 40, 460 160" />
          <path d="M-40 760 C 120 560, 260 800, 330 520 S 410 360, 450 380" />
        </g>
        {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} strokeWidth=".7" opacity={0.55 - i * 0.07} d={`M-40 ${700 - i * 7} C ${120 + i * 6} ${540 - i * 10}, ${260 - i * 5} ${790 - i * 8}, ${340 + i * 4} ${520 - i * 6} S ${410} ${380 + i * 6}, 450 ${400 + i * 6}`} />)}
        {[0, 1, 2, 3].map((i) => <path key={`b${i}`} strokeWidth=".7" opacity={0.5 - i * 0.1} d={`M-40 ${80 - i * 6} C ${80 + i * 5} ${30 - i * 4}, ${150} ${210 + i * 8}, ${300 + i * 3} ${130 + i * 5} S ${430} ${50 + i * 4}, 460 ${170 + i * 4}`} />)}
      </g>
    </svg>
  );
}
