export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-gold-500/20 blur-[120px]" />
      <div className="relative w-full max-w-md">
        <div className="glitch mb-6 text-center text-3xl font-extrabold tracking-tight"><span className="gold-text">Cafin</span> Pay</div>
        <div className="glass animate-rise rounded-3xl p-6 sm:p-8">{children}</div>
      </div>
    </div>
  );
}
