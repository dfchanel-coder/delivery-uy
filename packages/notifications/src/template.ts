/**
 * Message templates.
 *
 * Templates are data, not code: the copy lives here rather than inside a
 * business rule, so a translator or a product owner can read it without reading
 * TypeScript (AGENTS.md section 44).
 *
 * Interpolation is deliberately not a general expression language. Placeholders
 * are `{{name}}`, the renderer refuses a template whose data does not match
 * exactly, and every interpolated value is HTML-escaped. A template engine here
 * would be a dependency and an injection surface for no gain.
 */

export type TemplateValue = string | number | boolean;

export type TemplateData = Readonly<Record<string, TemplateValue>>;

export interface TemplateDefinition {
  readonly key: string;
  /** `{{name}}` placeholders. Used by the renderer and asserted by the tests. */
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface RenderedTemplate {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export class TemplateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes a value for an HTML body.
 *
 * Not optional: a recovery token is server-generated and opaque, but `appName`
 * and any future placeholder come from configuration or the database, and the
 * day one of them is attacker-influenced this becomes an injection. Cheaper to
 * always escape than to find out which ones are safe.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

function placeholdersIn(template: string): ReadonlySet<string> {
  const found = new Set<string>();

  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1];

    if (name !== undefined) {
      found.add(name);
    }
  }

  return found;
}

function renderOne(
  template: string,
  data: TemplateData,
  escape: (value: string) => string,
): string {
  return template.replace(PLACEHOLDER, (_match, rawName: string) => {
    const value = data[rawName];

    if (value === undefined) {
      throw new TemplateError(`Missing template value "${rawName}"`);
    }

    return escape(String(value));
  });
}

/**
 * Renders one template against `data`.
 *
 * Both directions are checked. A missing value would ship a message containing
 * the literal `{{token}}`; an unexpected one means the caller and the copy have
 * drifted apart, which is the same bug found sooner.
 */
export function renderTemplate(
  template: TemplateDefinition,
  data: TemplateData,
  locale: string,
): RenderedTemplate {
  const required = new Set<string>();

  for (const part of [template.subject, template.text, template.html]) {
    for (const name of placeholdersIn(part)) {
      required.add(name);
    }
  }

  for (const name of required) {
    if (data[name] === undefined) {
      throw new TemplateError(`Template "${template.key}" requires "${name}"`);
    }
  }

  for (const name of Object.keys(data)) {
    if (!required.has(name)) {
      throw new TemplateError(`Template "${template.key}" does not use "${name}"`);
    }
  }

  const expiresAt = formatInstant(data['expiresAt'], locale);

  const localized: TemplateData = expiresAt === undefined ? data : { ...data, expiresAt };

  return {
    subject: renderOne(template.subject, localized, escapeHtml),
    text: renderOne(template.text, localized, (value) => value),
    html: renderOne(template.html, localized, escapeHtml),
  };
}

/**
 * Formats an ISO instant for a reader in the message language.
 *
 * UTC on purpose: the recipient's timezone is not something the platform knows,
 * and a deadline shown in the wrong zone is worse than one that says UTC.
 * Returns the input unchanged when it is not an instant, so a caller that has
 * already formatted it is not mangled.
 */
function formatInstant(value: TemplateValue | undefined, locale: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    return undefined;
  }

  // An unknown or malformed locale must not fail the send: the deadline still
  // has to reach the person, so the raw value is better than no message.
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    });

    return `${formatter.format(new Date(parsed))} UTC`;
  } catch {
    return undefined;
  }
}
