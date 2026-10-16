import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { signShipmentBarcode } from '../../src/modules/fulfillment/services/shipment-label';
import { Actor } from './actors';

/** The run's driver scans the parcel label into custody; dispatch requires it for every stop (F1). */
export async function scanIntoCustody(app: INestApplication, driver: Actor, ...shipmentIds: string[]): Promise<void> {
  for (const shipmentId of shipmentIds) {
    await request(app.getHttpServer()).post(`/fulfillment/shipments/${shipmentId}/events`).set(driver.auth)
      .send({ type: 'HANDOFF_SCANNED', barcode: signShipmentBarcode(shipmentId) }).expect(201);
  }
}
