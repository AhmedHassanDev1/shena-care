import {
  isInsideServiceArea,
  isDefaultCentre,
  SERVICE_AREA_BOUNDS,
  DEFAULT_MAP_CENTRES,
  CAIRO_GIZA_AREAS,
} from '../lib/service-area';

describe('DeliveryLocationPicker bounds and rules', () => {
  it('accepts locations inside the Cairo & Giza service area', () => {
    // Maadi
    expect(isInsideServiceArea(29.9602, 31.2569)).toBe(true);
    // Dokki
    expect(isInsideServiceArea(30.0386, 31.2122)).toBe(true);
    // New Cairo / 5th Settlement
    expect(isInsideServiceArea(30.0131, 31.4289)).toBe(true);
    // 6th of October
    expect(isInsideServiceArea(29.9737, 30.9529)).toBe(true);
    // Heliopolis
    expect(isInsideServiceArea(30.0898, 31.3285)).toBe(true);
    // Sheikh Zayed
    expect(isInsideServiceArea(30.0488, 30.9856)).toBe(true);
  });

  it('rejects locations outside the Cairo & Giza service area', () => {
    // Alexandria
    expect(isInsideServiceArea(31.2001, 29.9187)).toBe(false);
    // Mansoura
    expect(isInsideServiceArea(31.0409, 31.3785)).toBe(false);
    // Aswan
    expect(isInsideServiceArea(24.0889, 32.8998)).toBe(false);
    // Tanta
    expect(isInsideServiceArea(30.7865, 31.0004)).toBe(false);
    // Outside Egypt
    expect(isInsideServiceArea(51.5074, -0.1278)).toBe(false);
  });

  it('detects default unplaced map centres that the backend rejects', () => {
    // Exact Cairo Tahrir default
    expect(isDefaultCentre(30.0444, 31.2357)).toBe(true);
    // Within 0.00004 of Tahrir default
    expect(isDefaultCentre(30.04442, 31.23571)).toBe(true);
    // Giza default
    expect(isDefaultCentre(30.0131, 31.2089)).toBe(true);
    // Egypt centroid default
    expect(isDefaultCentre(26.8206, 30.8025)).toBe(true);

    // Customer-placed pin away from default centres
    expect(isDefaultCentre(29.9602, 31.2569)).toBe(false);
    expect(isDefaultCentre(30.0386, 31.2122)).toBe(false);
  });

  it('ensures all preconfigured quick areas are within service area and not on default centres', () => {
    for (const area of CAIRO_GIZA_AREAS) {
      expect(isInsideServiceArea(area.lat, area.lng)).toBe(true);
      expect(isDefaultCentre(area.lat, area.lng)).toBe(false);
    }
  });

  it('matches the exact backend SERVICE_AREA_BOUNDS contract', () => {
    expect(SERVICE_AREA_BOUNDS).toEqual({
      minLat: 29.75,
      maxLat: 30.3,
      minLng: 30.8,
      maxLng: 31.8,
    });
    expect(DEFAULT_MAP_CENTRES).toHaveLength(4);
  });
});
