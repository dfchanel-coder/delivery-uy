export {
  TOKEN_PREFIX_PASSWORD_RESET,
  TOKEN_PREFIX_REFRESH,
  TOKEN_PREFIX_VERIFICATION,
  constantTimeEqual,
  generateDeliveryCode,
  generateOpaqueToken,
  generateSalt,
  hashVerificationCode,
  secureRandomInt,
  sha256Hex,
} from './crypto.js';

export {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  can,
  hasAnyRole,
  isRole,
  resolvePermissions,
} from './rbac.js';

export type { Permission, Role } from './rbac.js';

export { ACCESS_TOKEN_TYPE, AccessTokenError, createAccessTokenIssuer } from './access-token.js';

export type {
  AccessTokenClaims,
  AccessTokenConfig,
  AccessTokenIssuer,
  AccessTokenRejection,
  IssuedAccessToken,
} from './access-token.js';

export {
  DEFAULT_ARGON2_PARAMETERS,
  MAX_PASSWORD_LENGTH,
  TEST_ARGON2_PARAMETERS,
  checkPasswordPolicy,
  hashPassword,
  isArgon2idHash,
  passwordNeedsRehash,
  verifyPassword,
  verifyPasswordOrDummy,
} from './password.js';

export type { Argon2Parameters, PasswordPolicy } from './password.js';

export {
  principalCan,
  principalFromClaims,
  principalHasAnyRole,
  principalHasRole,
  principalOwns,
} from './principal.js';

export type { AuthenticatedPrincipal } from './principal.js';
