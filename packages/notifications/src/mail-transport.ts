/**
 * MailTransport - the boundary between "a message we produced" and "a message
 * some SMTP server accepted".
 *
 * A port rather than a nodemailer call site, for three reasons:
 *
 * - `NotificationProvider` must be testable without a mail server, and a real
 *   transport cannot be faked by a unit test;
 * - the SMTP client is not the only way to deliver email, and swapping it (SES,
 *   SendGrid, a local sink) must not reach into business logic
 *   (AGENTS.md section 60);
 * - the transport is where credentials and TLS settings live. Keeping it in one
 *   file is what makes it reviewable.
 */

/** One fully rendered message, ready to hand to a server. */
export interface OutgoingMail {
  readonly from: string;
  /** A single recipient. Messages are never sent to a list. */
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /**
   * Stable identifier for this logical message, so a retry is recognisable as a
   * retry. Must be opaque: it crosses an SMTP boundary.
   */
  readonly idempotencyKey: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<{ readonly messageId: string }>;
  /** Fails when the server is unreachable or refuses the credentials. */
  verify(): Promise<void>;
  close(): void;
}
