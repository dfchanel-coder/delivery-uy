import { createHash } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import type { MailTransport, OutgoingMail } from './mail-transport.js';

export interface SmtpTransportOptions {
  readonly host: string;
  readonly port: number;
  /** `true` upgrades the connection; a plaintext login is refused at startup. */
  readonly secure: boolean;
  readonly user?: string;
  readonly password?: string;
  /**
   * Refuses to hand over a message that could not be negotiated over TLS.
   *
   * Defaults to `true`. Turning it off exists for a development machine talking
   * to a local sink with no certificate, and the configuration schema refuses it
   * everywhere else; this class refuses it again so the guarantee does not
   * depend on that schema being the only caller.
   */
  readonly requireTls?: boolean;
  readonly connectionTimeoutMs?: number;
  readonly socketTimeoutMs?: number;
}

/**
 * nodemailer behind the `MailTransport` port.
 *
 * nodemailer is the only SMTP client in the dependency tree, and it is confined
 * to this file. Everything above it works against `MailTransport`, so a second
 * delivery mechanism is an addition here rather than a change anywhere else
 * (AGENTS.md section 95: actively maintained, no other standard-library option,
 * no vendor lock-in).
 *
 * nodemailer is imported eagerly because it is a declared dependency, not an
 * optional one; what stays behind the port is the *transport*, not the module.
 */
export class NodemailerMailTransport implements MailTransport {
  private readonly transporter: Transporter;

  public constructor(options: SmtpTransportOptions) {
    // Refused here rather than at the first send: a deployment that would put
    // SMTP credentials on the wire in clear text should not start at all
    // (SECURITY.md "Secrets").
    //
    // The test is `requireTls`, not `secure`. Port 587 with `secure: false` is
    // STARTTLS - the ordinary submission path - and refusing it would refuse the
    // configuration the schema deliberately allows. What must never happen is
    // asking for neither implicit TLS nor an upgrade, in which case nodemailer
    // would hand the password over as it stands.
    if (options.requireTls === false && options.user !== undefined) {
      throw new Error(
        'SMTP credentials require TLS: keep requireTls enabled so the connection is upgraded, or drop the credentials for an anonymous local sink',
      );
    }

    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      ...(options.user !== undefined && options.password !== undefined
        ? { auth: { user: options.user, pass: options.password } }
        : {}),
      requireTLS: options.requireTls ?? true,
      connectionTimeout: options.connectionTimeoutMs ?? 10_000,
      greetingTimeout: options.connectionTimeoutMs ?? 10_000,
      socketTimeout: options.socketTimeoutMs ?? 20_000,
    });
  }

  public async send(mail: OutgoingMail): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({
      from: mail.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      // Hashed rather than used verbatim: this header travels across the
      // internet and is quoted in bounces, and the key embeds user identifiers.
      messageId: `<${sha256Hex(mail.idempotencyKey)}@deliveryuy>`,
    });

    return { messageId: info.messageId };
  }

  public async verify(): Promise<void> {
    await this.transporter.verify();
  }

  public close(): void {
    this.transporter.close();
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
