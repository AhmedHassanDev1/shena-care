import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signShipmentBarcode } from '../../src/modules/fulfillment/services/shipment-label';

type Auth = { Authorization: string };

/**
 * Takes every parcel of a planned run into the courier's custody through the real handoff scan (signed label), the step a run needs before it
 * may be dispatched. Suites whose subject is what happens after dispatch use it instead of repeating the scans.
 */
export async function takeCustody(app: INestApplication, auth: Auth, batchId: string) {
  const http = () => request(app.getHttpServer());
  const run = await http().get(`/fulfillment/delivery-batches/${batchId}`).set(auth);
  if (run.status !== 200) return;
  for (const stop of run.body.stops as Array<{ shipmentId: string }>) {
    await http().post(`/fulfillment/delivery-batches/${batchId}/handoff-scan`).set(auth).send({ barcode: signShipmentBarcode(stop.shipmentId) });
  }
}
