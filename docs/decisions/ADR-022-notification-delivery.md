# ADR-022 - Delivering Password Recovery and Address Verification

Status: ACCEPTED

Refines ADR-002 (authentication) and ADR-013 (configuration and feature flags).
Completes the two open items PHASE 03 listed under its exit criteria.

## Context

PHASE 03 shipped password recovery and email verification with the token, the
hash, the storage, the expiry and the rate limits - but nothing ever sent the
message. `UnavailablePasswordRecoveryNotifier` resolved with a log line, so a
customer who asked to recover a password was told the request had been accepted
and then received nothing.

That was deliberate at the time: pretending a message had been sent is worse
than admitting none was, and PHASE 02 had not yet produced a notification
provider. It was a deferred decision, not a finished feature, and the roadmap
said so.

Delivering the message turned out to be four decisions rather than one, and
each of them is easy to get wrong in a way the tests would not catch.

## Decision

**`nodemailer` is the only SMTP client, and it is confined to one file.**
`packages/notifications/src/nodemailer-mail-transport.ts` is the sole `import`
in the workspace. Implementing SMTP by hand is a security liability rather than
an exercise in avoiding a dependency, and AGENTS.md section 95 asks whether a
dependency is necessary before adding one - here it is.

**`MailTransport` is a port, and the nodemailer call is behind it.**
`NotificationProvider` talks to `MailTransport`, not to nodemailer. This is what
makes `SmtpNotificationProvider` testable without a mail server, and what makes
SES, SendGrid or a local sink an *addition* rather than a change (AGENTS.md
section 60). The port is also what keeps the rest of the codebase free to know
nothing about SMTP.

**A send failure resolves with `accepted: false` rather than throwing.**
AGENTS.md section 23 says a notification failure must never corrupt or block an
order transition; the same reasoning applies to an account operation. A password
reset must succeed server-side even when the mail host is down, otherwise an
outage would let anyone invalidate every account's recovery code on demand. The
error field carries `error.name` only - the message body holds the token, and a
token in a log is a token in a log. `AuthService.startEmailVerification` also
contains a throwing notifier for the same reason, with the failure logged.

**The `Message-ID` is `sha256(idempotencyKey)`, never the key.** The header
crosses the internet and is quoted verbatim in bounces and DMARC reports. The
notifiers derive their key as `${templateKey}:${sha256Hex(token)}`, so a
genuine re-send of the same token reuses the same `Message-ID` - the property
that header exists for - while the token never reaches a header.

**Two ports, not one with a `kind` parameter.** `PasswordRecoveryNotifier` and
`EmailVerificationNotifier` are separate. One port with a discriminator is how a
recovery message ends up rendering the verification template, and the failure is
invisible until a customer reads it.

**The message carries a code, not a link.** A link requires deep-link routing in
the customer, merchant and driver applications, none of which exists. A link
that opens nothing is worse than an honest instruction, so the copy says "use
this code in the application". The recovery message also states that the platform
will never ask for a password by reply, and the templates are unit-tested
against that exact sentence: the first version of that guard used a loose
regular expression and matched its own copy, which is what a guard that cries
wolf looks like in practice.

**Copy lives in the package, in Spanish and Portuguese, with `es` as the
default.** A missing translation must not deny a password reset, so resolution
falls back `pt-BR` -> `pt` -> `es`. `renderTemplate` validates both directions -
a placeholder with no value and a value with no placeholder are both errors -
so a caller that renames a placeholder fails at the boundary rather than
shipping a literal `{{token}}` to a customer.

**`verifyEmail` and `confirmEmail` share one deployment decision.** PHASE 03
arrived with `activate: !requireEmailVerification`, which used one flag for two
questions: *should an address be proven?* and *does proving it make the account
usable?* With the flag on, a customer who proved their address stayed
`PENDING_VERIFICATION` forever with no route out, and `canSignIn` was
unreachable through HTTP. `ACCOUNT_APPROVAL_REQUIRED` (default `false`) is now
the second question, and the flow ends where it says it ends.

**Activation only moves a pending account forward.** `markEmailVerified` records
the proof unconditionally but activates through a conditional update guarded on
`PENDING_VERIFICATION`. Without the guard, a verification message that arrives
after an administrator suspended the account would lift that suspension through
a public endpoint, which would make suspending unenforceable (AGENTS.md sections
32 and 92). This is asserted against a real database in the integration suite.

**`SMTP_REQUIRE_TLS` exists and defaults to `true`.** Refusing a plaintext
connection outright would leave no way to see a real message on a laptop, where
Mailpit offers a self-signed certificate. The knob is for that case only: the
schema refuses it in a protected environment and whenever `SMTP_USER` is set,
and `NodemailerMailTransport` refuses it again in its constructor so the
guarantee does not depend on the schema being the only caller. The transport's
own guard tests `requireTls`, not `secure`, because port 587 with
`secure: false` is STARTTLS - the ordinary submission path - and refusing it
would refuse the configuration the schema deliberately allows.

**`UnavailableCodeDeliveryNotifier` remains, as a configured state.** With no
provider bound, the token is still created and hashed, and the notifier logs the
variables that would fix it. Turning a provider on changes delivery and nothing
else.

## Consequences

- A customer can complete a password reset and an address verification, verified
  end to end against a real SMTP conversation: both messages delivered as MIME,
  `verify()` succeeding at boot, and neither token appearing in any log line.
- `NOTIFICATION_PROVIDER=smtp` is a claim the configuration schema can falsify
  at startup rather than a failure discovered by the first customer who needs a
  reset.
- Swapping SMTP for another mechanism means implementing `MailTransport`. No
  caller changes.
- The API does not refuse to boot when the mail host is unreachable, and does not
  refuse to register an account. Coupling login availability to an SMTP host
  would contradict section 23 and turn a mail outage into an outage.
- Templates are user-facing text in a package rather than interpolated in a
  service, so adding a language is adding an entry and not editing a method.
- Two flags now decide whether an account becomes usable. A deployment that sets
  `ACCOUNT_APPROVAL_REQUIRED=true` without an administrative approval screen in
  place would hold accounts indefinitely - the schema cannot detect that, and
  `PROJECT_STATE.md` records it as an operator responsibility.

## Alternatives considered

- **Implement SMTP by hand.** Rejected: a security liability with no upside.
- **Keep the "message was sent" lie behind a logging notifier.** Rejected: it is
  the failure this ADR exists to remove.
- **A single notifier with a `kind`.** Rejected: the composition mistake it
  permits is silent.
- **A link instead of a code.** Deferred, not rejected. It needs deep-link
  routing in all three applications; when that exists, the templates change and
  nothing else does.
- **Throw on delivery failure.** Rejected: it makes an SMTP outage a way to deny
  password resets to every user at once.