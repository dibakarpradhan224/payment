import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#07070a', 900: '#0c0c10', 800: '#131318', 700: '#1b1b22', 600: '#26262f', 500: '#3a3a46' },
        gold: { 300: 'rgb(var(--g300) / <alpha-value>)', 400: 'rgb(var(--g400) / <alpha-value>)', 500: 'rgb(var(--g500) / <alpha-value>)', 600: 'rgb(var(--g600) / <alpha-value>)' },
      },
      boxShadow: { glow: '0 0 0 1px rgb(var(--g500) / .25), 0 8px 40px -12px rgb(var(--g500) / .35)' },
      keyframes: {
        pop: { '0%': { transform: 'scale(.6)', opacity: '0' }, '60%': { transform: 'scale(1.08)' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        draw: { to: { strokeDashoffset: '0' } },
        rise: { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        shake: { '0%,100%': { transform: 'translateX(0)' }, '20%,60%': { transform: 'translateX(-8px)' }, '40%,80%': { transform: 'translateX(8px)' } },
      },
      animation: { shake: 'shake .4s ease-in-out', pop: 'pop .45s ease-out both', draw: 'draw .6s .2s ease-out forwards', rise: 'rise .35s ease-out both' },
    },
  },
  plugins: [],
} satisfies Config;
