import type { InjectionToken } from '@nestjs/common';
import type { AdminReadModel } from './admin.ports.js';

/** Injection token for the admin read model. */
export const ADMIN_READ_MODEL: InjectionToken<AdminReadModel> = 'DELIVERYUY_ADMIN_READ_MODEL';
