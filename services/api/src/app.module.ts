import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './common/config/app-config.module.js';
import { DatabaseModule } from './common/database/database.module.js';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard.js';
import { RateLimitModule } from './common/rate-limit/rate-limit.module.js';
import { PermissionsGuard, RolesGuard } from './common/security/rbac.guards.js';
import { SecurityModule } from './common/security/security.module.js';
import { StorageModule } from './common/storage/storage.module.js';
import { JwtAuthGuard } from './common/security/jwt-auth.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { GeoModule } from './modules/geo/geo.module.js';
import { MerchantsModule } from './modules/merchants/merchants.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { UsersModule } from './modules/users/users.module.js';

/**
 * Application composition root (ARCHITECTURE.md section 4).
 *
 * Modules are wired here only; business rules live inside each module's
 * application services.
 *
 * The guard order below is the security order and is not arbitrary:
 * 1. `JwtAuthGuard` establishes who the caller is, so nothing after it runs on
 *    an anonymous request unless the route is explicitly `@Public()`;
 * 2. `RateLimitGuard` throttles abuse, keyed on the verified identity when a
 *    route asks for it;
 * 3. `RolesGuard` and `PermissionsGuard` answer whether that identity may act.
 *
 * Authentication is registered globally so that a new controller is protected by
 * default: forgetting a decorator leaves an endpoint closed, not open
 * (docs/API_RULES.md "Endpoint Security").
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['LOG_LEVEL'] ?? 'info',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-refresh-token"]',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.token',
            'req.body.refreshToken',
            'req.body.verificationCode',
            '*.password',
            '*.passwordHash',
            '*.accessToken',
            '*.refreshToken',
            '*.verificationCode',
            '*.apiKey',
            '*.cardNumber',
            '*.cvv',
          ],
          censor: '[redacted]',
        },
        // GPS coordinates of customers and drivers never appear in info logs.
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
      },
    }),
    AppConfigModule,
    CommonModule,
    SecurityModule,
    DatabaseModule,
    RateLimitModule,
    StorageModule,
    HealthModule,
    AuthModule,
    AuditModule,
    PlatformModule,
    GeoModule,
    MerchantsModule,
    AdminModule,
    UsersModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
