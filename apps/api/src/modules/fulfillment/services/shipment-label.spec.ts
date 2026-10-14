import { ServiceUnavailableException } from '@nestjs/common';
import { isValidShipmentBarcode, signShipmentBarcode } from './shipment-label';

/** GLO-206 GAP-12: shipment barcodes must never be signed with a guessable key outside dev/test. */
describe('shipment label signing', () => {
  const saved = { env: process.env.NODE_ENV, label: process.env.SHIPMENT_LABEL_SECRET, legacy: process.env.SECRET_KEY };
  const id = '3f1c2b4a-1111-4222-8333-944455556666';

  afterEach(() => {
    process.env.NODE_ENV = saved.env;
    for (const [key, value] of [['SHIPMENT_LABEL_SECRET', saved.label], ['SECRET_KEY', saved.legacy]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it.each(['production', 'staging', undefined])('fails closed without a strong secret when NODE_ENV=%s', (env) => {
    if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
    delete process.env.SHIPMENT_LABEL_SECRET;
    process.env.SECRET_KEY = 'short';
    expect(() => signShipmentBarcode(id)).toThrow(ServiceUnavailableException);
  });

  it('signs with the configured secret and verifies only the matching shipment', () => {
    process.env.NODE_ENV = 'production';
    process.env.SHIPMENT_LABEL_SECRET = 'a'.repeat(32);
    const barcode = signShipmentBarcode(id);
    expect(barcode).toMatch(/^SHP-3F1C2B4A-[0-9A-F]{16}$/);
    expect(isValidShipmentBarcode(id, barcode)).toBe(true);
    expect(isValidShipmentBarcode(id, barcode.toLowerCase())).toBe(true);
    expect(isValidShipmentBarcode('3f1c2b4a-1111-4222-8333-944455556667', barcode)).toBe(false);
    process.env.SHIPMENT_LABEL_SECRET = 'b'.repeat(32);
    expect(isValidShipmentBarcode(id, barcode)).toBe(false);
  });
});
