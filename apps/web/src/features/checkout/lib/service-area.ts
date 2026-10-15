/**
 * Cairo & Giza service area boundaries and map utilities.
 * Matches backend contracts in apps/api/src/modules/ordering/services/service-area.ts.
 */

export const SERVICE_AREA_BOUNDS = { minLat: 29.75, maxLat: 30.3, minLng: 30.8, maxLng: 31.8 } as const;

export const DEFAULT_MAP_CENTRES: Array<[number, number]> = [
  [30.0444, 31.2357], // Cairo (Tahrir)
  [30.0131, 31.2089], // Giza
  [30.0626, 31.2497], // Cairo (OSM centroid)
  [26.8206, 30.8025], // Egypt centroid
];

export const CAIRO_GIZA_AREAS = [
  { nameAr: 'المعادي', nameEn: 'Maadi', lat: 29.9602, lng: 31.2569 },
  { nameAr: 'الدقي', nameEn: 'Dokki', lat: 30.0386, lng: 31.2122 },
  { nameAr: 'المهندسين', nameEn: 'Mohandessin', lat: 30.0511, lng: 31.2003 },
  { nameAr: 'مدينة نصر', nameEn: 'Nasr City', lat: 30.0561, lng: 31.3301 },
  { nameAr: 'مصر الجديدة', nameEn: 'Heliopolis', lat: 30.0898, lng: 31.3285 },
  { nameAr: 'التجمع الخامس', nameEn: 'New Cairo', lat: 30.0131, lng: 31.4289 },
  { nameAr: 'الشيخ زايد', nameEn: 'Sheikh Zayed', lat: 30.0488, lng: 30.9856 },
  { nameAr: '٦ أكتوبر', nameEn: '6th of October', lat: 29.9737, lng: 30.9529 },
  { nameAr: 'الزمالك', nameEn: 'Zamalek', lat: 30.0614, lng: 31.2198 },
] as const;

export function isInsideServiceArea(lat: number, lng: number): boolean {
  const b = SERVICE_AREA_BOUNDS;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

export function isDefaultCentre(lat: number, lng: number): boolean {
  return DEFAULT_MAP_CENTRES.some(
    ([cLat, cLng]) => Math.abs(cLat - lat) < 0.00005 && Math.abs(cLng - lng) < 0.00005,
  );
}

export function projectMercator(lat: number, lng: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const x = n * ((lng + 180) / 360);
  const latRad = (lat * Math.PI) / 180;
  const y = (n * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) / 2;
  return { x: x * 256, y: y * 256 };
}

export function unprojectMercator(px: number, py: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const x = px / 256;
  const y = py / 256;
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lng };
}
