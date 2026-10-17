import type { Prisma } from '@prisma/client';
/** DTOs carry Dates; idempotency responses are stored as JSON, so round-trip them. */
export const json = <T>(v: T) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
