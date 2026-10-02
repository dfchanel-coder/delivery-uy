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

  configureApp(app);

  return app;
}

/**
 * The single Express setting this module reads.
 *
 * Nest types `HttpServer.getInstance()` as `any`; naming the one method used
 * here keeps the call type-checked without depending on `@types/express`
 * (AGENTS.md section 95, dependency policy).
 */
interface HttpServerInstance {
  set(setting: 'trust proxy', value: number): void;
}

/**
 * Applies every global concern to an application instance.
 *
 * Separate from {@link createApp} so a test can build the application itself
 * (with providers replaced) and still run against the identical configuration.
 * There is no test-only branch here: what the tests exercise is what production
 * runs.
 */
export function configureApp(app: INestApplication): void {
  app.use(helmet());
  app.enableShutdownHooks();

  const config = app.get(AppConfigService).get();

  // Trusting `X-Forwarded-For` is what makes `request.ip` (used by rate limits
  // and audit records) the real client address, but only as many hops as the
  // deployment actually declares. Trusting it blindly would let any caller forge
  // its own address (SECURITY.md "Rate Limits").
  if (config.auth.trustProxyHops > 0) {
    const server = app.getHttpAdapter().getInstance() as HttpServerInstance;
    server.set('trust proxy', config.auth.trustProxyHops);
  }

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
}
