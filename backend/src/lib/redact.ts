/** Tokens in URLs must never reach logs. */
export const redactUrl = (u: string) => u.replace(/([?&](?:token|key)=)[^&#]*/gi, '$1[REDACTED]');
