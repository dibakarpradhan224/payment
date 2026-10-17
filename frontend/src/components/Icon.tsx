const P: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  plus: 'M12 5v14M5 12h14',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  receive: 'M17 7 7 17M17 17H7V7',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10',
  wallet: 'M3 7a2 2 0 0 1 2-2h14v4M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8H5a2 2 0 0 1-2-2zM16 14h2',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  gateway: 'M3 6h18v12H3zM12 9v6M14 10.5c-.5-.6-1.2-.8-2-.8-1.1 0-2 .5-2 1.3 0 2 4 1 4 3 0 .8-.9 1.3-2 1.3-.8 0-1.5-.2-2-.8',
  user: 'M20 21a8 8 0 0 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  megaphone: 'M21 3 3 10l6 2.5L21 3zM9 12.5V19l3-3.5',
  headset: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v5H5a1 1 0 0 1-1-1zM20 14h-3v5h2a1 1 0 0 0 1-1zM17 19c0 1.5-2 2-5 2',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5zM12 15v2',
  backspace: 'M20 5H9l-6 7 6 7h11a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zM17 9l-5 6M12 9l5 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  bell: 'M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16zM10 21h4',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  fingerprint: 'M12 11v3M8.5 8.5a5 5 0 0 1 9 2.5v3M6 11a6 6 0 0 1 12 0M5 15c.5-2 1-3 1-5M9 20c1-2 1.5-4 1.5-7M13 21c.8-2 1-4 1-6M17 19c.6-1.5.9-3 .9-5',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  chevron: 'M9 6l6 6-6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeoff: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A16.6 16.6 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  play: 'M6 4l14 8-14 8z',
};
export type IconName = keyof typeof P;
export function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden><path d={P[name]} /></svg>;
}
