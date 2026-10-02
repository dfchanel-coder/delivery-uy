/**
 * Database enums re-exported for application code.
 *
 * Only the enums the platform actually stores in a column are exposed, so that
 * services never reach into `@prisma/client` directly: the client stays an
 * implementation detail of `@deliveryuy/database` (AGENTS.md section 7).
 *
 * They are string enums, so the values are identical to the names declared in
 * `prisma/schema.prisma` and to the `Role` union in `@deliveryuy/auth`.
 */

export { AppRole, RiskSeverity, UserStatus, VerificationTokenType } from '@prisma/client';
