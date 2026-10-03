import type { TemplateDefinition } from './template.js';

/**
 * The message catalog.
 *
 * Two languages because the platform targets Uruguay and Brazil (AGENTS.md
 * section 44), and `es` is the default the account locale falls back to. A
 * template with no `pt` translation falls back to `es` rather than failing: a
 * missing translation is a defect to notice, not a reason to deny someone their
 * password reset.
 *
 * The copy states a code and not a link on purpose. A link would need deep-link
 * routing in the applications, which does not exist yet, and a link that does
 * not open is worse than an honest instruction. Adding one is a change to these
 * templates plus a routing decision, not a change to the provider.
 */

const RECOVERY_ES: TemplateDefinition = {
  key: 'password-recovery',
  subject: 'Restablecé tu contraseña de {{appName}}',
  text: [
    'Hola,',
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta de {{appName}}.',
    'Usá este código en la aplicación para elegir una contraseña nueva:',
    '',
    '    {{token}}',
    '',
    'El código vence el {{expiresAt}}.',
    '',
    'Si no pediste restablecer tu contraseña, no hagas nada: la contraseña actual sigue',
    'siendo válida. Podés revisar tus sesiones desde la aplicación.',
    '',
    'Nunca respondemos a este mensaje pidiendo tu contraseña.',
  ].join('\n'),
  html: [
    '<p>Hola,</p>',
    '<p>Recibimos una solicitud para restablecer la contraseña de tu cuenta de {{appName}}.</p>',
    '<p>Usá este código en la aplicación para elegir una contraseña nueva:</p>',
    '<p><code>{{token}}</code></p>',
    '<p>El código vence el {{expiresAt}}.</p>',
    '<p>Si no pediste restablecer tu contraseña, no hagas nada: la contraseña actual sigue siendo válida. Podés revisar tus sesiones desde la aplicación.</p>',
    '<p>Nunca respondemos a este mensaje pidiendo tu contraseña.</p>',
  ].join('\n'),
};

const RECOVERY_PT: TemplateDefinition = {
  key: 'password-recovery',
  subject: 'Redefina sua senha do {{appName}}',
  text: [
    'Olá,',
    '',
    'Recebemos uma solicitação para redefinir a senha da sua conta do {{appName}}.',
    'Use este código no aplicativo para escolher uma nova senha:',
    '',
    '    {{token}}',
    '',
    'O código expira em {{expiresAt}}.',
    '',
    'Se você não pediu a redefinição, não faça nada: a senha atual continua válida.',
    'Você pode revisar suas sessões pelo aplicativo.',
    '',
    'Nunca respondemos a esta mensagem pedindo sua senha.',
  ].join('\n'),
  html: [
    '<p>Olá,</p>',
    '<p>Recebemos uma solicitação para redefinir a senha da sua conta do {{appName}}.</p>',
    '<p>Use este código no aplicativo para escolher uma nova senha:</p>',
    '<p><code>{{token}}</code></p>',
    '<p>O código expira em {{expiresAt}}.</p>',
    '<p>Se você não pediu a redefinição, não faça nada: a senha atual continua válida. Você pode revisar suas sessões pelo aplicativo.</p>',
    '<p>Nunca respondemos a esta mensagem pedindo sua senha.</p>',
  ].join('\n'),
};

const VERIFY_ES: TemplateDefinition = {
  key: 'email-verification',
  subject: 'Confirmá tu correo en {{appName}}',
  text: [
    'Hola,',
    '',
    'Confirmá esta dirección de correo para activar tu cuenta de {{appName}}.',
    'Usá este código en la aplicación:',
    '',
    '    {{token}}',
    '',
    'El código vence el {{expiresAt}}.',
    '',
    'Si no te registraste, ignorá este mensaje: no se creará ninguna cuenta.',
  ].join('\n'),
  html: [
    '<p>Hola,</p>',
    '<p>Confirmá esta dirección de correo para activar tu cuenta de {{appName}}.</p>',
    '<p>Usá este código en la aplicación:</p>',
    '<p><code>{{token}}</code></p>',
    '<p>El código vence el {{expiresAt}}.</p>',
    '<p>Si no te registraste, ignorá este mensaje: no se creará ninguna cuenta.</p>',
  ].join('\n'),
};

const VERIFY_PT: TemplateDefinition = {
  key: 'email-verification',
  subject: 'Confirme seu e-mail no {{appName}}',
  text: [
    'Olá,',
    '',
    'Confirme este endereço de e-mail para ativar sua conta do {{appName}}.',
    'Use este código no aplicativo:',
    '',
    '    {{token}}',
    '',
    'O código expira em {{expiresAt}}.',
    '',
    'Se você não se registrou, ignore esta mensagem: nenhuma conta será criada.',
  ].join('\n'),
  html: [
    '<p>Olá,</p>',
    '<p>Confirme este endereço de e-mail para ativar sua conta do {{appName}}.</p>',
    '<p>Use este código no aplicativo:</p>',
    '<p><code>{{token}}</code></p>',
    '<p>O código expira em {{expiresAt}}.</p>',
    '<p>Se você não se registrou, ignore esta mensagem: nenhuma conta será criada.</p>',
  ].join('\n'),
};

const CATALOG: Readonly<Record<string, Readonly<Record<string, TemplateDefinition>>>> = {
  es: {
    [RECOVERY_ES.key]: RECOVERY_ES,
    [VERIFY_ES.key]: VERIFY_ES,
  },
  pt: {
    [RECOVERY_PT.key]: RECOVERY_PT,
    [VERIFY_PT.key]: VERIFY_PT,
  },
};

/** Language every account falls back to. */
export const DEFAULT_TEMPLATE_LOCALE = 'es';

export const TEMPLATE_KEYS = ['password-recovery', 'email-verification'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Every template, for the tests that assert the catalog is complete. */
export function allTemplates(): readonly TemplateDefinition[] {
  return Object.values(CATALOG).flatMap((byLocale) => Object.values(byLocale));
}

/**
 * Resolves a template for a locale.
 *
 * Falls back `pt-BR` to `pt`, and anything unknown to `es`. Throws only when the
 * key itself is unknown, which is a programming error rather than a data
 * problem: shipping an unknown template key must not be silent.
 */
export function resolveTemplate(key: string, locale: string): TemplateDefinition {
  // Checked before the lookup so an unknown key is an error rather than a
  // fall-through to the default language's copy of something else.
  if (!isTemplateKey(key)) {
    throw new Error(`Unknown notification template "${key}"`);
  }

  const candidates = [locale, locale.split('-')[0] ?? locale, DEFAULT_TEMPLATE_LOCALE];

  for (const candidate of candidates) {
    const template = CATALOG[candidate]?.[key];

    if (template !== undefined) {
      return template;
    }
  }

  throw new Error(`No template "${key}" for any supported language`);
}

export function isTemplateKey(value: string): value is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(value);
}
