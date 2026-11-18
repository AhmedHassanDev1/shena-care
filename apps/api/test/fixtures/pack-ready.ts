import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setRuntimeSetting, SETTING_KEYS } from '../../src/platform/settings/runtime-settings';

type Auth = { Authorization: string };

/**
 * What a Hub operator must do before a verified parcel may be marked packed (handoff-ready): generate the label, confirm both papers printed,
 * and record the packaging actually used. Shared by suites whose subject is what happens after packing, not the packing rules themselves.
 */
export async function recordPackaging(app: INestApplication, auth: Auth, shipmentId: string, orderId?: string) {
  const http = () => request(app.getHttpServer());
  const id = orderId ?? ((await http().get(`/fulfillment/shipments/${shipmentId}`).set(auth).expect(200)).body.orderId as string);
  setRuntimeSetting(SETTING_KEYS.bagCost, 5);
  await http().put(`/order-costs/${id}`).set(auth).send({ packagingType: 'BAG' }).expect(200);
}

export async function makeReadyToPack(app: INestApplication, auth: Auth, shipmentId: string, orderId?: string) {
  const http = () => request(app.getHttpServer());
  await http().post(`/fulfillment/shipments/${shipmentId}/label`).set(auth).expect(201);
  await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(auth).send({ type: 'RECEIPT_PRINTED' }).expect(201);
  await http().post(`/fulfillment/shipments/${shipmentId}/events`).set(auth).send({ type: 'LABEL_PRINTED' }).expect(201);
  await recordPackaging(app, auth, shipmentId, orderId);
}
