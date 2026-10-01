import type { IsoDateTime, Uuid } from './api.js';

/**
 * Realtime event contracts (ADR-012, ARCHITECTURE.md section 10).
 *
 * Payloads carry only the minimum data a room is allowed to see. The server
 * decides room membership; clients never subscribe to arbitrary resources.
 */
export const REALTIME_EVENTS = {
  ORDER_UPDATED: 'order.updated',
  MERCHANT_ORDER_CREATED: 'merchant.order.created',
  DELIVERY_ASSIGNED: 'delivery.assigned',
  DELIVERY_LOCATION_UPDATED: 'delivery.location.updated',
  DELIVERY_TRACKING_CLOSED: 'delivery.tracking.closed',
  DISPATCH_OFFER: 'dispatch.offer',
  DRIVER_ASSIGNMENT_EXPIRED: 'driver.assignment.expired',
} as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

export interface RealtimeEnvelope<TPayload> {
  event: RealtimeEventName;
  occurredAt: IsoDateTime;
  correlationId?: Uuid;
  payload: TPayload;
}

export interface OrderUpdatedPayload {
  orderId: Uuid;
  orderCode: string;
  status: string;
  changedAt: IsoDateTime;
}

export interface DriverPositionPayload {
  deliveryId: Uuid;
  driverId: Uuid;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  heading?: number;
  recordedAt: IsoDateTime;
}

export interface DispatchOfferPayload {
  deliveryId: Uuid;
  orderCode: string;
  merchantName: string;
  pickup: { latitude: number; longitude: number };
  dropoff: { latitude: number; longitude: number };
  distanceMeters: number;
  offerExpiresAt: IsoDateTime;
}

export interface TrackingClosedPayload {
  deliveryId: Uuid;
  reason: 'DELIVERED' | 'CANCELLED' | 'EXPIRED';
}
