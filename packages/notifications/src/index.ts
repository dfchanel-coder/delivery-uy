/**
 * `@deliveryuy/notifications` - the notification boundary.
 *
 * A notification failure is reported, never raised into the operation that
 * triggered it: an unreachable SMTP server must not roll back an order or a
 * password reset (AGENTS.md section 23).
 *
 * What is exported is the port, the SMTP implementation and the template
 * catalog. Composition happens in the application, not here, so a second
 * delivery mechanism is an addition to the application rather than a change to
 * this package.
 */

export * from './mail-transport.js';
export * from './notification-provider.js';
export * from './nodemailer-mail-transport.js';
export * from './smtp-notification-provider.js';
export * from './template.js';
export * from './templates.js';
