# ADR-020 - Cryptography Libraries for Password Hashing and Access Tokens

Status: ACCEPTED

## Context

PHASE 03 has to implement two cryptographic primitives that must not be written
by hand:

- password hashing with **Argon2id** (`AGENTS.md` section 30, `SECURITY.md`
  "Password Storage");
- signing and verifying **JWT access tokens** (`ADR-002`).

Implementing either from scratch would be a security liability, so a library is
mandatory. What has to be decided is *which* one, and how the choice is kept
honest: `AGENTS.md` section 95 requires asking whether the dependency is
actively maintained, actually necessary, already solved by the standard library,
a security risk, or a source of vendor lock-in.

Two constraints shaped the decision:

- `packages/auth` was originally described as **zero-dependency**. That was true
  only because it shipped scrypt instead of Argon2id and no JWT support at all.
  Both gaps are closed here, so the description is retracted rather than kept as
  a slogan.
- The same rules must apply to tests: if the test suite validates a parameter the
  production code never uses, it proves nothing.

## Decision

`packages/auth` depends on exactly two third-party runtime packages:

| Package                                     | Used for                                                    | Why this one |
| ------------------------------------------- | ----------------------------------------------------------- | ------------ |
| [`@node-rs/argon2`](https://www.npmjs.com/package/@node-rs/argon2) | Argon2id password hashing and verification | Rust `argon2` crate behind N-API: actively maintained, no pure-JS fallback, prebuilt binaries for Windows/Linux/macOS including musl and arm64 |
| [`jose`](https://www.npmjs.com/package/jose) v6 | HS256 access token signing and verification                  | The reference JWT implementation, WHATWG-crypto based, isomorphic, zero dependencies of its own, constant-time signature comparison |

Consequences that are part of the decision:

1. **No JWT for refresh tokens.** Refresh tokens are opaque random values and
   only their SHA-256 hash is stored. `jose` is used for one thing only. This is
   already what `ADR-002` required ("refresh token representations are stored
   securely on backend") and it removes the whole class of "JWT refresh token
   revoked list" designs.
2. **No hand-written Argon2.** `@node-rs/argon2` is the only hashing entry
   point, exported through `hashPassword` / `verifyPassword` /
   `passwordNeedsRehash`, so the algorithm and parameter selection cannot drift
   between call sites.
3. **Parameters are configuration, not constants.**
   `PASSWORD_ARGON2_MEMORY_KIB` and `PASSWORD_ARGON2_ITERATIONS` flow through
   `packages/config`, and the parameters used are embedded in the hash string
   itself (`$argon2id$v=19$m=...,t=...,p=...$...`). Raising the parameters later
   therefore does not invalidate existing hashes: `passwordNeedsRehash` answers
   "yes" for any hash weaker than the current policy and the hash is upgraded on
   the next successful login.
4. **`@node-rs/argon2` exposes its enum-like parameters as ambient consts**, so
   the production code names the numeric values it needs
   (`ARGON2ID_ALGORITHM = 2`, `ARGON2_VERSION_0X13 = 1`) with a comment pointing
   at the upstream constant. They are wire values of the library API, not
   DeliveryUY configuration, which is why they are not environment variables.
5. **The test suite may weaken cost parameters, and must.** `TEST_ARGON2_PARAMETERS`
   exports the cheapest Argon2id settings the library accepts so unit tests do not
   spend seconds per hash. Any test that needs to reason about the *real*
   parameters hashes through the production path with production parameters.
6. **The package description no longer claims to be dependency-free.** The
   description names `ADR-002`, `ADR-010` and this ADR.

`packages/database` depends on `@deliveryuy/auth` (workspace) because the
development seed must hash real passwords with the real algorithm; a seed that
stored a placeholder hash would be a fake implementation (`AGENTS.md` section 5).

## Consequences

Positive:

- Argon2id is the documented preference instead of the scrypt compromise PHASE 01
  shipped, and the cost can be raised by configuration alone.
- JWT verification is a vetted implementation; algorithm, issuer and audience
  are pinned on every call, so `alg: none` and cross-issuer tokens are rejected
  by construction.
- Two runtime dependencies in the security package is a reviewable surface, and
  both are widely deployed with no transitive tree.

Negative and mitigations:

- `@node-rs/argon2` ships **no install script**. Its binaries arrive as
  per-platform optional dependencies (`@node-rs/argon2-win32-x64-msvc`,
  `@node-rs/argon2-linux-x64-gnu`, `@node-rs/argon2-linux-arm64-musl`, ...), so
  it needs no entry in the `allowBuilds` deny-by-default list
  (`pnpm-workspace.yaml`): adding an unneeded build-script exception would have
  been the opposite of the supply-chain control that file exists for. A platform
  with no published prebuild would fail to install loudly rather than silently
  compiling untrusted code, which is the correct failure mode.
- `jose` v6 requires ESM-capable interop. The monorepo compiles to CommonJS and
  `jose` v6 exposes a CommonJS entry point, so no build change was needed. This
  is recorded because a future major bump must be re-checked, not assumed.

## Alternatives considered

- **`argon2` (the Node binding)**: same upstream Rust crate, older packaging
  story, native build required more often. Rejected.
- **Pure-JS Argon2 (`argon2-browser`, `hash-wasm`)**: rejected. Slower at equal
  parameters, and the security budget of the platform's password KDF should not
  be spent on it.
- **Keeping scrypt from PHASE 01 and adding no dependency**: rejected.
  `SECURITY.md` says Argon2id preferred, and scrypt is not memory-hard at the
  parameter sizes that keep a login under 200 ms on a phone.
- **`jsonwebtoken`**: rejected in favour of `jose`: it has a large transitive tree
  and a weaker default posture.
- **Self-issued refresh tokens as JWTs**: rejected. Revocation would need a
  denylist, which is the stateful design this decision deliberately avoids.
- **`@node-rs/jwt` or `fast-jwt`**: rejected. `jose` is the reference
  implementation and needs no transitive dependencies.

## Legal

None. This decision contains no legal or employment-sensitive content.

## Related

- `ADR-002` - Authentication
- `ADR-010` - Delivery Verification Code
- `SECURITY.md` - "Password and Token Parameters"
- `packages/auth/src/password.ts` - the single hashing entry point