import { describe, expect, it } from 'vitest';
import { NotificationProviderNotConfiguredError } from './notification-provider.js';
import type { MailTransport, OutgoingMail } from './mail-transport.js';
import { NodemailerMailTransport } from './nodemailer-mail-transport.js';
import { SmtpNotificationProvider, UnconfiguredNotificationProvider } from './index.js';
import { TemplateError, escapeHtml, renderTemplate } from './template.js';
import {
  DEFAULT_TEMPLATE_LOCALE,
  TEMPLATE_KEYS,
  allTemplates,
  isTemplateKey,
  resolveTemplate,
} from './templates.js';
import type { NotificationMessage, NotificationProvider } from './notification-provider.js';

/** Captures what the provider asked the transport to send. */
class RecordingTransport implements MailTransport {
  public readonly sent: OutgoingMail[] = [];

  public constructor(private readonly behaviour: 'accept' | 'reject' | 'throw' = 'accept') {}

  public async send(mail: OutgoingMail): Promise<{ messageId: string }> {
    this.sent.push(mail);

    if (this.behaviour === 'throw') {
      throw new Error('ECONNREFUSED 10.0.2.2:587');
    }

    if (this.behaviour === 'reject') {
      throw new Error('550 mailbox unavailable');
    }

    return { messageId: `<${mail.idempotencyKey}@deliveryuy>` };
  }

  public async verify(): Promise<void> {
    /* no-op */
  }

  public close(): void {
    /* no-op */
  }
}

function recoveryMessage(overrides: Partial<NotificationMessage> = {}): NotificationMessage {
  return {
    channel: 'EMAIL',
    templateKey: 'password-recovery',
    recipient: 'person@example.com',
    locale: 'es',
    data: {
      appName: 'DeliveryUY',
      token: 'prt_abc123',
      expiresAt: '2026-10-03T02:00:00.000Z',
    },
    idempotencyKey: 'password-recovery:user-1:2026-10-02T20:00:00.000Z',
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes every character that can start a tag or attribute', () => {
    expect(escapeHtml(`<script>alert("x" & 'y')</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;',
    );
  });

  it('leaves ordinary text alone', () => {
    expect(escapeHtml('Restablecé tu contraseña')).toBe('Restablecé tu contraseña');
  });
});

describe('renderTemplate', () => {
  it('substitutes into the subject, text and html bodies', () => {
    const rendered = renderTemplate(
      resolveTemplate('password-recovery', 'es'),
      {
        appName: 'DeliveryUY',
        token: 'prt_abc123',
        expiresAt: '2026-10-03T02:00:00.000Z',
      },
      'es',
    );

    expect(rendered.subject).toContain('DeliveryUY');
    expect(rendered.text).toContain('prt_abc123');
    expect(rendered.html).toContain('prt_abc123');
  });

  it('refuses a value the template needs but the caller did not supply', () => {
    // Shipping `{{token}}` to a customer is the failure this prevents.
    expect(() =>
      renderTemplate(
        resolveTemplate('password-recovery', 'es'),
        { appName: 'DeliveryUY', expiresAt: '2026-10-03T02:00:00.000Z' },
        'es',
      ),
    ).toThrow(TemplateError);
  });

  it('refuses a value the template does not use', () => {
    expect(() =>
      renderTemplate(
        resolveTemplate('password-recovery', 'es'),
        {
          appName: 'DeliveryUY',
          token: 'prt_abc123',
          expiresAt: '2026-10-03T02:00:00.000Z',
          role: 'ADMIN',
        },
        'es',
      ),
    ).toThrow(/does not use "role"/);
  });

  it('escapes an injected value in the html body and not in the text body', () => {
    const rendered = renderTemplate(
      resolveTemplate('password-recovery', 'es'),
      {
        appName: '<img src=x onerror=alert(1)>',
        token: 'prt_abc123',
        expiresAt: '2026-10-03T02:00:00.000Z',
      },
      'es',
    );

    expect(rendered.html).not.toContain('<img');
    expect(rendered.html).toContain('&lt;img');
    expect(rendered.text).toContain('<img src=x');
  });

  it('renders the deadline for a reader instead of the raw instant', () => {
    const rendered = renderTemplate(
      resolveTemplate('password-recovery', 'es'),
      {
        appName: 'DeliveryUY',
        token: 'prt_abc123',
        expiresAt: '2026-10-03T02:00:00.000Z',
      },
      'es',
    );

    expect(rendered.text).toContain('UTC');
    expect(rendered.text).not.toContain('2026-10-03T02:00:00.000Z');
  });

  it('survives a locale it cannot format instead of failing the send', () => {
    const rendered = renderTemplate(
      resolveTemplate('password-recovery', 'es'),
      {
        appName: 'DeliveryUY',
        token: 'prt_abc123',
        expiresAt: '2026-10-03T02:00:00.000Z',
      },
      'not a locale',
    );

    expect(rendered.text).toContain('prt_abc123');
  });
});

describe('template catalog', () => {
  it('declares every key in every language', () => {
    for (const key of TEMPLATE_KEYS) {
      expect(isTemplateKey(key)).toBe(true);

      for (const locale of ['es', 'pt']) {
        expect(resolveTemplate(key, locale).key).toBe(key);
      }
    }
  });

  it('uses the same placeholders in every language of a template', () => {
    // A translation that drops `{{token}}` would ship a message with no code in
    // it, and nothing else would notice.
    for (const key of TEMPLATE_KEYS) {
      const es = resolveTemplate(key, 'es');
      const pt = resolveTemplate(key, 'pt');
      const names = (body: string): string[] =>
        [...body.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g)]
          .map((match) => match[1] ?? '')
          .sort();

      expect(names(pt.text)).toEqual(names(es.text));
      expect(names(pt.html)).toEqual(names(es.html));
      expect(names(pt.subject)).toEqual(names(es.subject));
    }
  });

  it('falls back to the region variant and then to the default language', () => {
    expect(resolveTemplate('password-recovery', 'pt-BR').subject).toContain('Redefina');
    expect(resolveTemplate('password-recovery', 'en')).toEqual(
      resolveTemplate('password-recovery', DEFAULT_TEMPLATE_LOCALE),
    );
  });

  it('refuses an unknown key rather than sending the wrong message', () => {
    expect(() => resolveTemplate('order-shipped', 'es')).toThrow(/Unknown notification template/);
  });

  it('never asks the reader to hand over a password', () => {
    // Exact constructions rather than a regex: the copy legitimately contains
    // "Nunca respondemos a este mensaje pidiendo tu contraseña", which a loose
    // pattern flags, and a guard that cries wolf gets deleted.
    const forbidden = [
      'envianos tu contraseña',
      'envia sua senha',
      'envía tu contraseña',
      'responde con',
      'responda con',
      'reply with your password',
    ];

    for (const template of allTemplates()) {
      const copy = `${template.subject} ${template.text} ${template.html}`.toLowerCase();

      for (const phrase of forbidden) {
        expect(copy).not.toContain(phrase);
      }
    }
  });
});

describe('SmtpNotificationProvider', () => {
  it('sends the rendered message through the transport', async () => {
    const transport = new RecordingTransport();
    const provider = new SmtpNotificationProvider(transport, {
      from: 'DeliveryUY <no-reply@deliveryuy.example>',
    });

    const result = await provider.send(recoveryMessage());

    expect(result.accepted).toBe(true);
    expect(result.provider).toBe('smtp');
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe('person@example.com');
    expect(transport.sent[0]?.from).toBe('DeliveryUY <no-reply@deliveryuy.example>');
    expect(transport.sent[0]?.subject).toContain('DeliveryUY');
    expect(transport.sent[0]?.idempotencyKey).toContain('password-recovery');
  });

  it('reports a refusal instead of throwing', async () => {
    // A notification failure must never roll back the operation that caused it.
    const provider = new SmtpNotificationProvider(new RecordingTransport('reject'), {
      from: 'no-reply@deliveryuy.example',
    });

    await expect(provider.send(recoveryMessage())).resolves.toMatchObject({ accepted: false });
  });

  it('reports an unreachable server instead of throwing', async () => {
    const provider = new SmtpNotificationProvider(new RecordingTransport('throw'), {
      from: 'no-reply@deliveryuy.example',
    });

    const result = await provider.send(recoveryMessage());

    expect(result.accepted).toBe(false);
    expect(result.error).toBe('Error');
  });

  it('never leaks the message body into the reported error', async () => {
    const provider = new SmtpNotificationProvider(new RecordingTransport('throw'), {
      from: 'no-reply@deliveryuy.example',
    });

    const result = await provider.send(recoveryMessage());

    // The error name only. The body carries the recovery token.
    expect(JSON.stringify(result)).not.toContain('prt_abc123');
  });

  it('refuses a channel it cannot carry', async () => {
    const provider = new SmtpNotificationProvider(new RecordingTransport(), {
      from: 'no-reply@deliveryuy.example',
    });

    const result = await provider.send(recoveryMessage({ channel: 'PUSH' }));

    expect(result.accepted).toBe(false);
    expect(provider.supports('PUSH')).toBe(false);
    expect(provider.supports('EMAIL')).toBe(true);
  });

  it('refuses an unusable recipient', async () => {
    const transport = new RecordingTransport();
    const provider = new SmtpNotificationProvider(transport, {
      from: 'no-reply@deliveryuy.example',
    });

    const result = await provider.send(recoveryMessage({ recipient: '  ' }));

    expect(result.accepted).toBe(false);
    expect(transport.sent).toHaveLength(0);
  });

  it('reports an unknown template as a failed send', async () => {
    const provider = new SmtpNotificationProvider(new RecordingTransport(), {
      from: 'no-reply@deliveryuy.example',
    });

    const result = await provider.send(recoveryMessage({ templateKey: 'nope' }));

    expect(result.accepted).toBe(false);
  });
});

describe('UnconfiguredNotificationProvider', () => {
  it('rejects every send rather than pretending', async () => {
    // Held as the port, not as the class, so the calls go through the signature a
    // caller actually sees.
    const provider: NotificationProvider = new UnconfiguredNotificationProvider();

    expect(provider.getName()).toBe('none');
    expect(provider.supports('EMAIL')).toBe(false);
    await expect(provider.send(recoveryMessage())).rejects.toBeInstanceOf(
      NotificationProviderNotConfiguredError,
    );
  });
});

describe('NodemailerMailTransport', () => {
  it('refuses to authenticate once TLS is switched off', () => {
    // The one thing that must never happen: a login the server never asked to be
    // encrypted, with nothing in the client insisting on an upgrade.
    expect(
      () =>
        new NodemailerMailTransport({
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          requireTls: false,
          user: 'apikey',
          password: 'secret',
        }),
    ).toThrow(/credentials require TLS/);
  });

  it('accepts the ordinary STARTTLS submission path', () => {
    // Port 587 with `secure: false` is STARTTLS, not clear text: `requireTls`
    // makes the upgrade mandatory and the server refuses it otherwise. Refusing
    // this combination would refuse the configuration the schema allows.
    expect(
      () =>
        new NodemailerMailTransport({
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          user: 'apikey',
          password: 'secret',
        }),
    ).not.toThrow();
  });

  it('accepts a plaintext port when no credentials are configured', () => {
    expect(
      () => new NodemailerMailTransport({ host: 'localhost', port: 1025, secure: false }),
    ).not.toThrow();
  });

  it('accepts a plaintext port with requireTls off for a local sink', () => {
    // The documented reason the knob exists: seeing a real message on a laptop
    // without a certificate to trust.
    expect(
      () =>
        new NodemailerMailTransport({
          host: '127.0.0.1',
          port: 2525,
          secure: false,
          requireTls: false,
        }),
    ).not.toThrow();
  });
});
