export const buildUserQr = (paymentId: string, amount?: string) => `payment://pay?to=${paymentId}${amount ? `&amount=${amount}` : ''}`;
