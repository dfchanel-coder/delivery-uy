import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { NOTIFICATION_PROVIDER } from './notification.tokens.js';
import type { NotificationProvider } from '@deliveryuy/notifications';

interface VerifiableProvider {
  verify(): Promise<void>;
  close(): void;
}

function isVerifiable(
  provider: NotificationProvider,
): provider is NotificationProvider & VerifiableProvider {
  return (
    typeof (provider as Partial<VerifiableProvider>).verify === 'function' &&
    typeof (provider as Partial<VerifiableProvider>).close === 'function'
  );
}

/**
 * Reports at startup whether the configured mail server answers.
 *
 * It logs and starts. Refusing to boot would couple the availability of login,
 * registration and every order to the availability of an SMTP host, which is the
 * opposite of what "a notification failure must not block the operation" means
 * (AGENTS.md section 23). A misconfigured provider is still visible, at the one
 * moment an operator is watching the logs at startup.
 */
@Injectable()
export class NotificationHealthProbe implements OnModuleInit {
  private readonly logger = new Logger(NotificationHealthProbe.name);

  public constructor(
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
  ) {}

  public async onModuleInit(): Promise<void> {
    if (!isVerifiable(this.provider)) {
      return;
    }

    try {
      await this.provider.verify();
      this.logger.log(`Notification provider "${this.provider.getName()}" is reachable`);
    } catch (error) {
      this.logger.error(
        `Notification provider "${this.provider.getName()}" is not reachable: ` +
          `${error instanceof Error ? error.name : 'unknown error'}. ` +
          'Messages will be reported as failed deliveries.',
      );
    }
  }

  public onModuleDestroy(): void {
    if (isVerifiable(this.provider)) {
      this.provider.close();
    }
  }
}
