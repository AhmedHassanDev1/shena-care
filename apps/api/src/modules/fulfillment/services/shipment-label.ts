import { ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';

// Only local development and tests may sign labels without a configured secret.
const DEV_ONLY_LABEL_SECRET = 'shena-care-dev-only-shipment-label-secret';
const MIN_SECRET_LENGTH = 32;

function labelSecret(): string {
  const configured = process.env.SHIPMENT_LABEL_SECRET || process.env.SECRET_KEY;
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured;
  const env = process.env.NODE_ENV;
  if (env === 'development' || env === 'test') return DEV_ONLY_LABEL_SECRET;
  // Fail closed: a guessable key would let anyone forge a scannable shipment barcode.
  throw new ServiceUnavailableException('Shipment label signing is not configured');
}

/** Opaque, scannable shipment identity: no PII, verifiable only with the server secret. */
export function signShipmentBarcode(shipmentId: string): string {
  const signature = crypto.createHmac('sha256', labelSecret()).update(shipmentId).digest('hex').substring(0, 16);
  return `SHP-${shipmentId.substring(0, 8).toUpperCase()}-${signature.toUpperCase()}`;
}

export function isValidShipmentBarcode(shipmentId: string, scanned: string): boolean {
  const expected = Buffer.from(signShipmentBarcode(shipmentId));
  const actual = Buffer.from(scanned.trim().toUpperCase());
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
