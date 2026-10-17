export const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, (_m, a, b) => `${a}***${b}`);
export const maskMobile = (m: string) => `${m.slice(0, 2)}******${m.slice(-2)}`;
export const maskUpi = (u: string) => u.replace(/^(.{1,2}).*(@.*)$/, (_m, a, b) => `${a}***${b}`);
