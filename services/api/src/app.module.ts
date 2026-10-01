import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './common/config/app-config.module.js';
import { HealthModule } from './modules/health/health.module.js';

/**
 * Application composition root (ARCHITECTURE.md section 4).
 *
 * Modules are wired here only; business rules live inside each module's
 * application services.
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
    HealthModule,
  ],
})
export class AppModule {}
