# ADR-021 - Credential Persistence in the Mobile Applications

Status: ACCEPTED

Refines ADR-002 (authentication) and ADR-018 (frontend workspaces).

## Context

The API issues an access token that lives about fifteen minutes and an opaque
refresh token that rotates on every use (SECURITY.md, ADR-002). The customer
application kept both in memory, which meant two defects that only show up in
real use:

- closing the application lost the session, so an order in progress was lost with
  it;
- an access token that expired while the application was open ended a session that
  had been working a minute earlier.

Something has to survive a process restart, and a bearer credential surviving on
disk is exactly what SECURITY.md is about. Three questions had to be answered:
what is persisted, where it lives, and who renews it.

Constraints already in force:

- `AGENTS.md` section 7 forbids duplicating shared logic across applications, and
  the customer, merchant and driver applications need the same behaviour;
- ADR-018 keeps `packages/dart/core` free of platform plugins, because it is
  consumed by all three Flutter builds;
- a token file that survives an uninstall or rides along in a backup is worse than
  losing the session.

## Decision

**Only the refresh token is persisted.** The access token is never written
anywhere. It is short lived and is obtained again from the refresh token on
startup, so storing it would widen the window in which a lifted file yields a
usable credential without gaining anything.

**The port lives in `packages/dart/core`, the implementation in each
application.** `TokenStore` is a three-method interface (`read`, `write`,
`clear`) with `InMemoryTokenStore` as the shipped in-memory implementation.
`SecureTokenStore` in `apps/customer` implements it over `flutter_secure_storage`,
which resolves to AES-GCM values under a key wrapped by the Android Keystore on
Android and to a keychain item on iOS. The customer, merchant and driver
applications supply their own implementation, so no plugin dependency is forced
on a build that does not need it.

**The record is namespaced by API origin.** `StoredSession` carries the
`apiBaseUrl` that issued it and the store keys on it. Secure storage is scoped to
the application install, not to the deployment, so a debug build pointing at a
laptop and a release build pointing at a real API share one keyspace on one
device. Replaying a token issued by one API against another is at best a
confusing failure and at worst a credential sent to a host the user did not
intend.

**The controller owns renewal, and it happens in two ways.**

- *Reactively*: `loadAccount` retries a `401 UNAUTHENTICATED` once after
  exchanging the refresh token. The retry is bounded, because a rejected refresh
  means the token is gone and a loop would turn one expiry into a request storm.
- *Proactively*: `ensureFreshSession` renews when the access token is inside a
  leeway, so a protected request does not have to fail first. An expiry that
  cannot be parsed counts as expired, because renewing unnecessarily costs one
  request while trusting an unreadable value sends a dead credential.

**Launch order is explicit.** `main` calls `WidgetsFlutterBinding.ensureInitialized`
and then `restore()` before `runApp`, so a restored session does not flash the
sign-in form and then the session screen. A failure inside `restore` is silent by
design: nobody asked for anything at launch.

**Failure direction is chosen deliberately.**

- a refresh token the API rejects is deleted, because it can never work again;
- a refresh token that failed because the API was unreachable is kept, because the
  API rejected nothing;
- the stored token is removed before the revocation call on sign-out, so a network
  failure cannot leave a usable credential behind;
- a keystore that cannot be read leaves the application signed out rather than
  crashing, and a keystore that cannot be written does not prevent a sign-in that
  already succeeded.

## Consequences

- Restarting the application no longer ends the session, and a fifteen-minute
  access token no longer ends one mid-order.
- Only the refresh token is on disk, encrypted with a key the operating system
  does not export, and it is discarded when the application is uninstalled.
- `flutter_secure_storage` is a new dependency of `apps/customer` only. It is
  maintained under the Flutter community, adds no vendor lock-in and is the
  platform standard; the alternative was writing the value into
  `SharedPreferences`, which is plain text on the device.
- The iOS keychain item uses `first_unlock_this_device`, so it does not ride along
  in an unencrypted backup. Session persistence therefore does not survive a
  device-to-device migration, which is deliberate: the user signs in again on the
  new device.
- `SecureTokenStore` cannot be unit tested, because it is a platform channel. It
  is tested by being exercised on a device, and the logic around it is tested
  against `InMemoryTokenStore`. That split is the reason the port exists.
- The merchant and driver applications still hold their sessions in memory. They
  will need `SecureTokenStore` before their sessions are worth anything; the port
  is in place precisely so that is a file addition and not a redesign.

## Alternatives considered

1. **Persist the whole session, access token included.** Rejected: a stored access
   token is a credential with a value even after it expires on the server, and it
   buys nothing because the refresh token already produces a new one.
2. **Persist in `SharedPreferences` or a plain file.** Rejected: the value would
   be readable from a backup or from root on a compromised device. This is the
   failure SECURITY.md exists to prevent.
3. **Put `flutter_secure_storage` in `packages/dart/core`.** Rejected: it would
   force a platform plugin on all three applications, including builds that have
   no use for it, contradicting the shape ADR-018 established.
4. **Renew only reactively.** Rejected as the sole mechanism: it makes every
   protected request pay for the expiry with a failed round trip first, which is
   visible latency exactly when the user is waiting.
5. **Renew only proactively, on a timer.** Rejected: a background timer keeps the
   session alive for an application nobody is looking at, and it makes token
   rotation happen at times the user did not choose.
6. **A biometric gate in front of the stored token.** Not adopted. It is a
   reasonable product requirement and the plugin supports it
   (`AndroidOptions.biometric`), but nothing in the documented requirements asks
   for it and it would change what signing in means. Recorded here so the choice
   is visible if it is ever requested.

## Legal

None. Session persistence on the user's own device does not introduce a new
category of personal data: the value stored is an opaque credential, not location,
identity or order data.

## Related

- `ADR-002` - Authentication
- `ADR-018` - Frontend Workspaces and Shared Client Logic
- `SECURITY.md` - Password and Token Parameters, session storage
- `packages/dart/core/lib/src/token_store.dart`
- `apps/customer/lib/src/secure_token_store.dart`