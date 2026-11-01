import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Delivery service area (GLO-231 owner decision, 14 Oct): COD delivery in Cairo and Giza only, to a
 * pin the customer placed and confirmed. The bounds are a deliberately generous box around Greater
 * Cairo (incl. New Cairo, 6th of October, Helwan, Obour); a pin outside it is improbable for these
 * governorates. No geocoding provider is used, so the address text is never auto-converted to a pin.
 */
const GOVERNORATES: Record<string, 'Cairo' | 'Giza'> = {
  cairo: 'Cairo', 'القاهرة': 'Cairo',
  giza: 'Giza', 'الجيزة': 'Giza',
};
export const SERVICE_AREA_BOUNDS = { minLat: 29.75, maxLat: 30.3, minLng: 30.8, maxLng: 31.8 } as const;

/** Map widgets' default centres: a pin left exactly there was not placed by the customer. */
const DEFAULT_MAP_CENTRES: Array<[number, number]> = [
  [30.0444, 31.2357], // Cairo (Tahrir) — Google Maps default
  [30.0131, 31.2089], // Giza
  [30.0626, 31.2497], // Cairo (OSM/Nominatim centroid)
  [26.8206, 30.8025], // Egypt centroid
];

/** Customer-confirmed pin sources. Address geocoding is not a confirmation and is refused. */
export const CONFIRMED_PIN_SOURCES = ['map_pin', 'current_location'] as const;

const fail = (code: string, message: string): never => {
  throw new UnprocessableEntityException({ code, message });
};

export function serviceGovernorate(governorate: string): 'Cairo' | 'Giza' {
  return GOVERNORATES[governorate.trim().toLowerCase()] ??
    fail('OUT_OF_SERVICE_AREA', 'Delivery is available in Cairo and Giza only.');
}

export function assertDeliverablePin(pin: { latitude?: number | null; longitude?: number | null }): void {
  const { latitude, longitude } = pin;
  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    fail('LOCATION_PIN_REQUIRED', 'Place and confirm your delivery location on the map.');
  }
  const lat = latitude as number; const lng = longitude as number;
  if (DEFAULT_MAP_CENTRES.some(([cLat, cLng]) => Math.abs(cLat - lat) < 0.00005 && Math.abs(cLng - lng) < 0.00005)) {
    fail('LOCATION_PIN_IMPROBABLE', 'Move the pin to your exact delivery location.');
  }
  const b = SERVICE_AREA_BOUNDS;
  if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) {
    fail('OUT_OF_SERVICE_AREA', 'This location is outside our Cairo and Giza delivery area.');
  }
}

/** Keyless deep link any phone opens in Google Maps (or the browser) for turn-by-turn navigation. */
export function navigationUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

/**
 * ShinaCare fulfillment hub coordinates (route origin for future dispatch and delivery runs).
 * Kept separate from customer delivery locations.
 */
export const SHINACARE_HUB_COORDINATES = {
  latitude: 29.997164,
  longitude: 31.149644,
  name: 'ShinaCare Main Fulfillment Hub',
} as const;

export function getDeliveryHubCoordinates(): { latitude: number; longitude: number; name: string } {
  const envLat = process.env.DELIVERY_HUB_LAT ? Number(process.env.DELIVERY_HUB_LAT) : NaN;
  const envLng = process.env.DELIVERY_HUB_LNG ? Number(process.env.DELIVERY_HUB_LNG) : NaN;
  return {
    latitude: Number.isFinite(envLat) ? envLat : SHINACARE_HUB_COORDINATES.latitude,
    longitude: Number.isFinite(envLng) ? envLng : SHINACARE_HUB_COORDINATES.longitude,
    name: SHINACARE_HUB_COORDINATES.name,
  };
}

