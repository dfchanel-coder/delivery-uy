import { Global, MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module.js';
import { AllExceptionsFilter } from './filters/all-exceptions.filter.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';

/**
 * Cross-cutting HTTP concerns: correlation ids, structured errors and the
 * validated configuration.
 */
@Global()
@Module({
  imports: [AppConfigModule],
  providers: [AllExceptionsFilter],
  exports: [AppConfigModule, AllExceptionsFilter],
})
export class CommonModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestIdMiddleware).forRoutes('*');
  }
}
