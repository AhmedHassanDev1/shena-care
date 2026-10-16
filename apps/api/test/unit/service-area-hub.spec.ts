import { UnprocessableEntityException } from '@nestjs/common';
import {
  serviceGovernorate,
  assertDeliverablePin,
  navigationUrl,
  SHINACARE_HUB_COORDINATES,
  getDeliveryHubCoordinates,
} from '../../src/modules/ordering/public';

describe('service-area and delivery hub policy (Maps Phase 1)', () => {
  describe('serviceGovernorate', () => {
    it('accepts Cairo and Giza in English and Arabic', () => {
      expect(serviceGovernorate('Cairo')).toBe('Cairo');
      expect(serviceGovernorate('cairo')).toBe('Cairo');
      expect(serviceGovernorate('القاهرة')).toBe('Cairo');
      expect(serviceGovernorate('Giza')).toBe('Giza');
      expect(serviceGovernorate('giza')).toBe('Giza');
      expect(serviceGovernorate('الجيزة')).toBe('Giza');
    });

    it('rejects governorates outside Cairo and Giza', () => {
      for (const invalid of ['Alexandria', 'الإسكندرية', 'Mansoura', 'Aswan', 'Gharbia', '']) {
        expect(() => serviceGovernorate(invalid)).toThrow(UnprocessableEntityException);
      }
    });
  });

  describe('assertDeliverablePin', () => {
    it('accepts valid deliverable locations in Cairo and Giza', () => {
      // Maadi
      expect(() => assertDeliverablePin({ latitude: 29.9602, longitude: 31.2569 })).not.toThrow();
      // Dokki
      expect(() => assertDeliverablePin({ latitude: 30.0386, longitude: 31.2122 })).not.toThrow();
      // New Cairo
      expect(() => assertDeliverablePin({ latitude: 30.0131, longitude: 31.4289 })).not.toThrow();
      // 6th of October
      expect(() => assertDeliverablePin({ latitude: 29.9737, longitude: 30.9529 })).not.toThrow();
    });

    it('rejects missing or non-finite pin coordinates', () => {
      expect(() => assertDeliverablePin({ latitude: undefined, longitude: 31.2569 })).toThrow(UnprocessableEntityException);
      expect(() => assertDeliverablePin({ latitude: 29.9602, longitude: null })).toThrow(UnprocessableEntityException);
      expect(() => assertDeliverablePin({ latitude: NaN, longitude: 31.2569 })).toThrow(UnprocessableEntityException);
      expect(() => assertDeliverablePin({ latitude: Infinity, longitude: 31.2569 })).toThrow(UnprocessableEntityException);
    });

    it('rejects unplaced default map centres', () => {
      // Tahrir centroid
      expect(() => assertDeliverablePin({ latitude: 30.0444, longitude: 31.2357 })).toThrow(UnprocessableEntityException);
      // Giza default
      expect(() => assertDeliverablePin({ latitude: 30.0131, longitude: 31.2089 })).toThrow(UnprocessableEntityException);
      // OSM centroid
      expect(() => assertDeliverablePin({ latitude: 30.0626, longitude: 31.2497 })).toThrow(UnprocessableEntityException);
    });

    it('rejects locations outside Cairo and Giza service area bounds', () => {
      // Alexandria
      expect(() => assertDeliverablePin({ latitude: 31.2001, longitude: 29.9187 })).toThrow(UnprocessableEntityException);
      // Mansoura
      expect(() => assertDeliverablePin({ latitude: 31.0409, longitude: 31.3785 })).toThrow(UnprocessableEntityException);
      // Aswan
      expect(() => assertDeliverablePin({ latitude: 24.0889, longitude: 32.8998 })).toThrow(UnprocessableEntityException);
      // London
      expect(() => assertDeliverablePin({ latitude: 51.5074, longitude: -0.1278 })).toThrow(UnprocessableEntityException);
    });
  });

  describe('ShinaCare Fulfillment Hub coordinates', () => {
    it('has exact configured hub coordinates as future route origin', () => {
      expect(SHINACARE_HUB_COORDINATES.latitude).toBe(29.997164);
      expect(SHINACARE_HUB_COORDINATES.longitude).toBe(31.149644);
      expect(SHINACARE_HUB_COORDINATES.name).toBe('ShinaCare Main Fulfillment Hub');
    });

    it('resolves hub coordinates through getDeliveryHubCoordinates', () => {
      const hub = getDeliveryHubCoordinates();
      expect(hub.latitude).toBe(29.997164);
      expect(hub.longitude).toBe(31.149644);
    });

    it('keeps hub coordinates distinct from customer default map centres', () => {
      // Hub is not a rejected default map center
      expect(() => assertDeliverablePin(SHINACARE_HUB_COORDINATES)).not.toThrow();
    });

    it('formats keyless navigation deep link', () => {
      const link = navigationUrl(SHINACARE_HUB_COORDINATES.latitude, SHINACARE_HUB_COORDINATES.longitude);
      expect(link).toBe('https://www.google.com/maps/dir/?api=1&destination=29.997164,31.149644');
    });
  });
});
