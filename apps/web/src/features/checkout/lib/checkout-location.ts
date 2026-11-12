import { CAIRO_GIZA_AREAS, isDefaultCentre, isInsideServiceArea } from './service-area';

type Pin = { latitude: number; longitude: number; confirmed: boolean };

export function isDeliverablePin(pin: Pin | null | undefined): boolean {
  return Boolean(pin?.confirmed && Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude) &&
    isInsideServiceArea(pin.latitude, pin.longitude) && !isDefaultCentre(pin.latitude, pin.longitude));
}

type SavedPin = Pin & { locationSource: 'map_pin' | 'current_location' };

export async function saveConfirmedPin(
  addressId: string,
  pin: SavedPin,
  update: (request: { id: string; data: { latitude: number; longitude: number; locationSource: SavedPin['locationSource'] } }) => Promise<unknown>,
): Promise<void> {
  if (!isDeliverablePin(pin)) throw new Error('Invalid delivery pin');
  await update({ id: addressId, data: {
    latitude: pin.latitude, longitude: pin.longitude, locationSource: pin.locationSource,
  } });
}

export interface LocationSuggestion {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  deliverable: boolean;
}

export interface LocationSearchResult {
  items: LocationSuggestion[];
  providerFailed: boolean;
}

function validCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function normaliseSearch(value: string): string {
  return value.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').trim();
}

/** Search is only a pin suggestion. The customer must still confirm the exact location. */
export async function searchDeliveryLocations(
  query: string,
  options: { token?: string; locale?: string; signal?: AbortSignal; fetcher?: typeof fetch } = {},
): Promise<LocationSearchResult> {
  const term = query.trim();
  if (!term) return { items: [], providerFailed: false };

  const coordinates = /^(-?\d+(?:\.\d+)?)\s*[,،]\s*(-?\d+(?:\.\d+)?)$/.exec(term);
  if (coordinates) {
    const latitude = Number(coordinates[1]);
    const longitude = Number(coordinates[2]);
    return {
      items: validCoordinates(latitude, longitude) ? [{
        id: `coordinates-${latitude}-${longitude}`, name: term, latitude, longitude,
        deliverable: isInsideServiceArea(latitude, longitude) && !isDefaultCentre(latitude, longitude),
      }] : [],
      providerFailed: false,
    };
  }

  const normalised = normaliseSearch(term);
  const local = CAIRO_GIZA_AREAS.filter((area) =>
    normaliseSearch(area.nameAr).includes(normalised) || normaliseSearch(area.nameEn).includes(normalised),
  ).map((area) => ({
    id: `area-${area.nameEn}`, name: `${area.nameAr} / ${area.nameEn}`,
    latitude: area.lat, longitude: area.lng, deliverable: true,
  }));

  const token = options.token?.trim();
  if (!token) return { items: local, providerFailed: false };
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(term)}.json?access_token=${encodeURIComponent(token)}&language=${options.locale?.startsWith('en') ? 'en' : 'ar'}&country=eg&limit=5`;
    const response = await (options.fetcher ?? fetch)(url, { signal: options.signal });
    if (!response.ok) return { items: local, providerFailed: true };
    const data: unknown = await response.json();
    const features = data && typeof data === 'object' && 'features' in data && Array.isArray(data.features) ? data.features : [];
    const remote: LocationSuggestion[] = features.flatMap((feature: unknown) => {
      if (!feature || typeof feature !== 'object' || !('center' in feature) || !Array.isArray(feature.center)) return [];
      const [longitude, latitude] = feature.center;
      if (typeof latitude !== 'number' || typeof longitude !== 'number' || !validCoordinates(latitude, longitude)) return [];
      const record = feature as { id?: unknown; place_name?: unknown };
      return [{
        id: typeof record.id === 'string' ? record.id : `remote-${latitude}-${longitude}`,
        name: typeof record.place_name === 'string' ? record.place_name : `${latitude}, ${longitude}`,
        latitude, longitude,
        deliverable: isInsideServiceArea(latitude, longitude) && !isDefaultCentre(latitude, longitude),
      }];
    });
    return { items: [...remote, ...local], providerFailed: false };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { items: local, providerFailed: true };
  }
}
