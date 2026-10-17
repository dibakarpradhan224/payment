export function normalizeUtr(raw: string): string {
  const u = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z0-9]{12,22}$/.test(u)) throw new Error('Enter a valid transaction ID (12-22 letters or digits).');
  return u;
}
