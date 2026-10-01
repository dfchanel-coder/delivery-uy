// Required by NestJS dependency injection (constructor parameter metadata).
// It lives here, not in `main.ts`, so that integration tests build the exact
// same application object as production.
import 'reflect-metadata';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AppConfigService } from './common/config/app-config.service.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor.js';

export const API_PREFIX = 'api/v1';
export const SWAGGER_PATH = 'api/docs';

/**
 * Builds the configured Nest application.
 *
 * Kept separate from `main.ts` so integration tests exercise exactly the same
 * configuration as production (ADR-016).
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.enableShutdownHooks();

  const config = app.get(AppConfigService).get();

  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({
    origin: [...config.service.corsOrigins],
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerDocument = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('DeliveryUY API')
      .setDescription(
        'Multi-merchant local delivery marketplace. All endpoints are versioned under /api/v1.',
      )
      .setVersion('1.0.0')
      // No explicit server entry: `@nestjs/swagger` already prefixes every path
      // with the global `/api/v1` prefix, so the document defaults to its own
      // origin. Hardcoding a host would break behind a reverse proxy or a
      // multi-domain deployment (AGENTS.md section 35).
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addGlobalParameters({
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        description: 'Replays a create request safely (ADR-011).',
      })
      .build(),
  );
  SwaggerModule.setup(SWAGGER_PATH, app, swaggerDocument, {
    swaggerOptions: { persistAuthorization: false },
  });

  return app;
}
