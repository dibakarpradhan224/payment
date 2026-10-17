// The browser only ever talks to this origin; cookies stay first-party. API_URL is the backend (server-side only).
const API = process.env.API_URL || 'http://localhost:4000';
export default {
  output: 'standalone',
  reactStrictMode: true,
  devIndicators: false, // hides the round "N" Next.js badge shown only in development
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/web/:path*', destination: `${API}/web/:path*` },
      { source: '/admin/v1/:path*', destination: `${API}/admin/v1/:path*` },
      // Local dev only: in production Caddy sends /api/v1 straight to the backend. Lets the docs "Try it" console work on localhost.
      { source: '/api/:path*', destination: `${API}/api/:path*` },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=()' },
    ] }];
  },
};
