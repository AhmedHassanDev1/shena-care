import {
  SERVICE_AREA_BOUNDS,
  isInsideServiceArea,
  isDefaultCentre,
} from './service-area';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type Governorate = 'Cairo' | 'Giza';

export interface LocationCatalogItem {
  id: string;
  nameAr: string;
  nameEn: string;
  governorate: Governorate;
  areaAr: string;
  areaEn: string;
  latitude: number;
  longitude: number;
  category: 'neighborhood' | 'landmark' | 'city';
  keywords: string[];
}

export interface SearchResultItem {
  id: string;
  name: string;
  secondary: string;
  coordinates: Coordinates;
  governorate: Governorate;
  area: string;
  category: 'neighborhood' | 'landmark' | 'address';
  source: 'catalog' | 'provider' | 'fallback';
}

export interface GeocodedAddressSuggestion {
  governorate: Governorate;
  area: string;
  streetAddress: string;
  building?: string;
  fullFormatted: string;
  isInsideServiceArea: boolean;
  source: 'provider' | 'catalog' | 'fallback';
}

/**
 * Curated high-precision catalog of Greater Cairo and Giza neighborhoods,
 * cities, and recognizable landmarks for instant, resilient search.
 */
export const CAIRO_GIZA_CATALOG: LocationCatalogItem[] = [
  // Cairo - Major Neighborhoods & Districts
  {
    id: 'cairo-maadi',
    nameAr: 'المعادي',
    nameEn: 'Maadi',
    governorate: 'Cairo',
    areaAr: 'المعادي',
    areaEn: 'Maadi',
    latitude: 29.9602,
    longitude: 31.2569,
    category: 'neighborhood',
    keywords: ['maadi', 'المعادي', 'معادي', 'degla', 'دجلة', 'sarayat', 'السرايات'],
  },
  {
    id: 'cairo-degla-maadi',
    nameAr: 'دجلة المعادي',
    nameEn: 'Degla Maadi',
    governorate: 'Cairo',
    areaAr: 'المعادي',
    areaEn: 'Maadi',
    latitude: 29.9685,
    longitude: 31.2782,
    category: 'neighborhood',
    keywords: ['degla', 'دجلة', 'maadi', 'المعادي'],
  },
  {
    id: 'cairo-zahraa-maadi',
    nameAr: 'زهراء المعادي',
    nameEn: 'Zahraa El Maadi',
    governorate: 'Cairo',
    areaAr: 'زهراء المعادي',
    areaEn: 'Zahraa El Maadi',
    latitude: 29.9721,
    longitude: 31.3005,
    category: 'neighborhood',
    keywords: ['zahraa', 'زهراء', 'maadi', 'المعادي'],
  },
  {
    id: 'cairo-new-cairo-5th',
    nameAr: 'التجمع الخامس',
    nameEn: 'New Cairo (5th Settlement)',
    governorate: 'Cairo',
    areaAr: 'التجمع الخامس',
    areaEn: 'New Cairo',
    latitude: 30.0131,
    longitude: 31.4289,
    category: 'neighborhood',
    keywords: ['new cairo', '5th settlement', 'التجمع', 'الخامس', 'القاهرة الجديدة', 'tagamoa'],
  },
  {
    id: 'cairo-new-cairo-1st',
    nameAr: 'التجمع الأول',
    nameEn: '1st Settlement',
    governorate: 'Cairo',
    areaAr: 'التجمع الأول',
    areaEn: '1st Settlement',
    latitude: 30.0536,
    longitude: 31.4589,
    category: 'neighborhood',
    keywords: ['1st settlement', 'التجمع الاول', 'التجمع الأول', 'new cairo'],
  },
  {
    id: 'cairo-nasr-city',
    nameAr: 'مدينة نصر',
    nameEn: 'Nasr City',
    governorate: 'Cairo',
    areaAr: 'مدينة نصر',
    areaEn: 'Nasr City',
    latitude: 30.0561,
    longitude: 31.3301,
    category: 'neighborhood',
    keywords: ['nasr city', 'مدينة نصر', 'عباس العقاد', 'مكرم عبيد', 'tayaran'],
  },
  {
    id: 'cairo-heliopolis',
    nameAr: 'مصر الجديدة',
    nameEn: 'Heliopolis',
    governorate: 'Cairo',
    areaAr: 'مصر الجديدة',
    areaEn: 'Heliopolis',
    latitude: 30.0898,
    longitude: 31.3285,
    category: 'neighborhood',
    keywords: ['heliopolis', 'مصر الجديدة', 'korba', 'الكوربة', 'roxy', 'روكسي', 'merghany', 'الميرغني'],
  },
  {
    id: 'cairo-sheraton',
    nameAr: 'مساكن شيراتون',
    nameEn: 'Sheraton Heliopolis',
    governorate: 'Cairo',
    areaAr: 'مصر الجديدة',
    areaEn: 'Heliopolis',
    latitude: 30.1065,
    longitude: 31.3812,
    category: 'neighborhood',
    keywords: ['sheraton', 'شيراتون', 'مصر الجديدة'],
  },
  {
    id: 'cairo-zamalek',
    nameAr: 'الزمالك',
    nameEn: 'Zamalek',
    governorate: 'Cairo',
    areaAr: 'الزمالك',
    areaEn: 'Zamalek',
    latitude: 30.0614,
    longitude: 31.2198,
    category: 'neighborhood',
    keywords: ['zamalek', 'الزمالك', '26 july', 'geezira', 'الجزيرة'],
  },
  {
    id: 'cairo-downtown',
    nameAr: 'وسط البلد',
    nameEn: 'Downtown Cairo',
    governorate: 'Cairo',
    areaAr: 'وسط البلد',
    areaEn: 'Downtown',
    latitude: 30.0475,
    longitude: 31.2411,
    category: 'neighborhood',
    keywords: ['downtown', 'وسط البلد', 'tahrir', 'التحرير', 'talaat harb', 'طلعت حرب'],
  },
  {
    id: 'cairo-garden-city',
    nameAr: 'جاردن سيتي',
    nameEn: 'Garden City',
    governorate: 'Cairo',
    areaAr: 'جاردن سيتي',
    areaEn: 'Garden City',
    latitude: 30.0354,
    longitude: 31.2312,
    category: 'neighborhood',
    keywords: ['garden city', 'جاردن سيتي', 'قصر العيني'],
  },
  {
    id: 'cairo-mokattam',
    nameAr: 'المقطم',
    nameEn: 'Mokattam',
    governorate: 'Cairo',
    areaAr: 'المقطم',
    areaEn: 'Mokattam',
    latitude: 30.0152,
    longitude: 31.3054,
    category: 'neighborhood',
    keywords: ['mokattam', 'المقطم', 'الهضبة الوسطى', 'upland'],
  },
  {
    id: 'cairo-rehab',
    nameAr: 'مدينة الرحاب',
    nameEn: 'Al Rehab City',
    governorate: 'Cairo',
    areaAr: 'الرحاب',
    areaEn: 'Al Rehab',
    latitude: 30.0612,
    longitude: 31.4937,
    category: 'city',
    keywords: ['rehab', 'الرحاب', 'مدينة الرحاب', 'new cairo'],
  },
  {
    id: 'cairo-madinaty',
    nameAr: 'مدينتي',
    nameEn: 'Madinaty',
    governorate: 'Cairo',
    areaAr: 'مدينتي',
    areaEn: 'Madinaty',
    latitude: 30.0988,
    longitude: 31.6284,
    category: 'city',
    keywords: ['madinaty', 'مدينتي', 'talaat moustafa'],
  },
  {
    id: 'cairo-shorouk',
    nameAr: 'مدينة الشروق',
    nameEn: 'El Shorouk City',
    governorate: 'Cairo',
    areaAr: 'الشروق',
    areaEn: 'El Shorouk',
    latitude: 30.1384,
    longitude: 31.6189,
    category: 'city',
    keywords: ['shorouk', 'الشروق', 'مدينة الشروق'],
  },
  {
    id: 'cairo-obour',
    nameAr: 'مدينة العبور',
    nameEn: 'El Obour City',
    governorate: 'Cairo',
    areaAr: 'العبور',
    areaEn: 'El Obour',
    latitude: 30.2285,
    longitude: 31.4721,
    category: 'city',
    keywords: ['obour', 'العبور', 'مدينة العبور'],
  },
  {
    id: 'cairo-helwan',
    nameAr: 'حلوان',
    nameEn: 'Helwan',
    governorate: 'Cairo',
    areaAr: 'حلوان',
    areaEn: 'Helwan',
    latitude: 29.8494,
    longitude: 31.3342,
    category: 'neighborhood',
    keywords: ['helwan', 'حلوان', 'عين حلوان'],
  },
  {
    id: 'cairo-shubra',
    nameAr: 'شبرا',
    nameEn: 'Shubra',
    governorate: 'Cairo',
    areaAr: 'شبرا',
    areaEn: 'Shubra',
    latitude: 30.0812,
    longitude: 31.2465,
    category: 'neighborhood',
    keywords: ['shubra', 'شبرا', 'شبرا مصر', 'douran'],
  },
  {
    id: 'cairo-katameya',
    nameAr: 'القطامية',
    nameEn: 'Katameya',
    governorate: 'Cairo',
    areaAr: 'القطامية',
    areaEn: 'Katameya',
    latitude: 29.9885,
    longitude: 31.3912,
    category: 'neighborhood',
    keywords: ['katameya', 'القطامية', 'katameya heights'],
  },

  // Giza - Major Neighborhoods & Cities
  {
    id: 'giza-dokki',
    nameAr: 'الدقي',
    nameEn: 'Dokki',
    governorate: 'Giza',
    areaAr: 'الدقي',
    areaEn: 'Dokki',
    latitude: 30.0386,
    longitude: 31.2122,
    category: 'neighborhood',
    keywords: ['dokki', 'الدقي', 'mossadak', 'مصدق', 'tahrir st', 'ميدان المساحة'],
  },
  {
    id: 'giza-mohandessin',
    nameAr: 'المهندسين',
    nameEn: 'Mohandessin',
    governorate: 'Giza',
    areaAr: 'المهندسين',
    areaEn: 'Mohandessin',
    latitude: 30.0511,
    longitude: 31.2003,
    category: 'neighborhood',
    keywords: ['mohandessin', 'المهندسين', 'جامعة الدول', 'shehab', 'شهاب', 'lebanon sq', 'ميدان لبنان'],
  },
  {
    id: 'giza-sheikh-zayed',
    nameAr: 'مدينة الشيخ زايد',
    nameEn: 'Sheikh Zayed City',
    governorate: 'Giza',
    areaAr: 'الشيخ زايد',
    areaEn: 'Sheikh Zayed',
    latitude: 30.0488,
    longitude: 30.9856,
    category: 'city',
    keywords: ['sheikh zayed', 'الشيخ زايد', 'زايد', 'zayed', 'arakan', 'beverly hills'],
  },
  {
    id: 'giza-6th-october',
    nameAr: 'مدينة ٦ أكتوبر',
    nameEn: '6th of October City',
    governorate: 'Giza',
    areaAr: '٦ أكتوبر',
    areaEn: '6th of October',
    latitude: 29.9737,
    longitude: 30.9529,
    category: 'city',
    keywords: ['6th of october', 'october', 'أكتوبر', '٦ أكتوبر', 'الحصري', 'hosary', 'zayed'],
  },
  {
    id: 'giza-agouza',
    nameAr: 'العجوزة',
    nameEn: 'Agouza',
    governorate: 'Giza',
    areaAr: 'العجوزة',
    areaEn: 'Agouza',
    latitude: 30.0585,
    longitude: 31.2142,
    category: 'neighborhood',
    keywords: ['agouza', 'العجوزة', 'nile', 'نوال'],
  },
  {
    id: 'giza-haram',
    nameAr: 'شارع الهرم',
    nameEn: 'Al Haram',
    governorate: 'Giza',
    areaAr: 'الهرم',
    areaEn: 'Al Haram',
    latitude: 29.9985,
    longitude: 31.1852,
    category: 'neighborhood',
    keywords: ['haram', 'الهرم', 'فيصل', 'شارع الهرم'],
  },
  {
    id: 'giza-faisal',
    nameAr: 'شارع فيصل',
    nameEn: 'Faisal',
    governorate: 'Giza',
    areaAr: 'فيصل',
    areaEn: 'Faisal',
    latitude: 30.0075,
    longitude: 31.1782,
    category: 'neighborhood',
    keywords: ['faisal', 'فيصل', 'شارع فيصل', 'عشرين'],
  },
  {
    id: 'giza-hadayek-ahram',
    nameAr: 'حدائق الأهرام',
    nameEn: 'Hadayek Al Ahram',
    governorate: 'Giza',
    areaAr: 'حدائق الأهرام',
    areaEn: 'Hadayek Al Ahram',
    latitude: 29.9782,
    longitude: 31.1125,
    category: 'neighborhood',
    keywords: ['hadayek al ahram', 'حدائق الاهرام', 'حدائق الأهرام', 'بوابات'],
  },
  {
    id: 'giza-imbaba',
    nameAr: 'إمبابة',
    nameEn: 'Imbaba',
    governorate: 'Giza',
    areaAr: 'إمبابة',
    areaEn: 'Imbaba',
    latitude: 30.0712,
    longitude: 31.2095,
    category: 'neighborhood',
    keywords: ['imbaba', 'إمبابة', 'امبابة', 'مدينة العمال'],
  },
  {
    id: 'giza-square',
    nameAr: 'ميدان الجيزة',
    nameEn: 'Giza Square',
    governorate: 'Giza',
    areaAr: 'الجيزة',
    areaEn: 'Giza',
    latitude: 30.0112,
    longitude: 31.2078,
    category: 'neighborhood',
    keywords: ['giza', 'الجيزة', 'ميدان الجيزة', 'جامعة القاهرة', 'mourad'],
  },

  // Cairo & Giza Recognizable Landmarks
  {
    id: 'landmark-cairo-tower',
    nameAr: 'برج القاهرة',
    nameEn: 'Cairo Tower',
    governorate: 'Cairo',
    areaAr: 'الزمالك',
    areaEn: 'Zamalek',
    latitude: 30.0459,
    longitude: 31.2243,
    category: 'landmark',
    keywords: ['cairo tower', 'برج القاهرة', 'البرج', 'الجزيرة'],
  },
  {
    id: 'landmark-cairo-university',
    nameAr: 'جامعة القاهرة',
    nameEn: 'Cairo University',
    governorate: 'Giza',
    areaAr: 'الجيزة',
    areaEn: 'Giza',
    latitude: 30.0276,
    longitude: 31.2084,
    category: 'landmark',
    keywords: ['cairo university', 'جامعة القاهرة', 'بين السرايات'],
  },
  {
    id: 'landmark-cfc-mall',
    nameAr: 'كايرو فستيفال سيتي مول',
    nameEn: 'Cairo Festival City Mall',
    governorate: 'Cairo',
    areaAr: 'التجمع الخامس',
    areaEn: 'New Cairo',
    latitude: 30.0298,
    longitude: 31.4072,
    category: 'landmark',
    keywords: ['cfc', 'cairo festival city', 'كايرو فستيفال', 'التجمع الخامس'],
  },
  {
    id: 'landmark-citystars',
    nameAr: 'سيتي ستارز مول',
    nameEn: 'Citystars Mall',
    governorate: 'Cairo',
    areaAr: 'مدينة نصر',
    areaEn: 'Nasr City',
    latitude: 30.0732,
    longitude: 31.3468,
    category: 'landmark',
    keywords: ['citystars', 'سيتي ستارز', 'مدينة نصر'],
  },
  {
    id: 'landmark-mall-of-arabia',
    nameAr: 'مول العرب',
    nameEn: 'Mall of Arabia',
    governorate: 'Giza',
    areaAr: '٦ أكتوبر',
    areaEn: '6th of October',
    latitude: 30.0072,
    longitude: 30.9734,
    category: 'landmark',
    keywords: ['mall of arabia', 'مول العرب', 'اكتوبر', 'زايد'],
  },
  {
    id: 'landmark-mall-of-egypt',
    nameAr: 'مول مصر',
    nameEn: 'Mall of Egypt',
    governorate: 'Giza',
    areaAr: '٦ أكتوبر',
    areaEn: '6th of October',
    latitude: 29.9725,
    longitude: 31.0182,
    category: 'landmark',
    keywords: ['mall of egypt', 'مول مصر', 'الواحات', 'اكتوبر'],
  },
  {
    id: 'landmark-arakan-plaza',
    nameAr: 'أركان بلازا',
    nameEn: 'Arkan Plaza',
    governorate: 'Giza',
    areaAr: 'الشيخ زايد',
    areaEn: 'Sheikh Zayed',
    latitude: 30.0382,
    longitude: 31.0062,
    category: 'landmark',
    keywords: ['arkan', 'اركان', 'أركان بلازا', 'الشيخ زايد'],
  },
  {
    id: 'landmark-grand-egyptian-museum',
    nameAr: 'المتحف المصري الكبير',
    nameEn: 'Grand Egyptian Museum (GEM)',
    governorate: 'Giza',
    areaAr: 'الهرم',
    areaEn: 'Al Haram',
    latitude: 29.9954,
    longitude: 31.1198,
    category: 'landmark',
    keywords: ['gem', 'grand egyptian museum', 'المتحف المصري الكبير', 'الهرم', 'ميدان الرماية'],
  },
];

/**
 * Normalise Arabic text for fuzzy substring search (removes diacritics, unifies alef, taa marbuta, etc.)
 */
export function normaliseArabicSearch(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\u064B-\u065F]/g, '') // strip tashkeel
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
}

/**
 * Determine the authoritative governorate for Cairo/Giza service area.
 */
export function determineGovernorate(
  latitude: number,
  longitude: number,
  rawRegion?: string,
): Governorate {
  const norm = (rawRegion ?? '').toLowerCase();
  if (norm.includes('giza') || norm.includes('جيزة') || norm.includes('eg-gz')) {
    return 'Giza';
  }
  if (norm.includes('cairo') || norm.includes('قاهرة') || norm.includes('eg-c')) {
    return 'Cairo';
  }

  // Geographic boundary fallback:
  // 6th of October / Sheikh Zayed are west of lng 31.12 -> Giza
  if (longitude < 31.12) return 'Giza';
  // Central west bank of Nile (Dokki, Mohandessin, Agouza, Imbaba, Haram, Faisal, Giza):
  // Longitude roughly 31.12 to 31.22
  if (longitude < 31.225 && latitude <= 30.08) return 'Giza';

  // East bank (Zamalek island, Maadi, New Cairo, Nasr City, Heliopolis, Downtown): Cairo
  return 'Cairo';
}

/**
 * Calculate euclidean distance in km for proximity ranking.
 */
function approxDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111;
  const dLng = (lng2 - lng1) * 111 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Find the closest known neighborhood from the curated catalog.
 */
export function findNearestCatalogItem(lat: number, lng: number): LocationCatalogItem | null {
  let closest: LocationCatalogItem | null = null;
  let minDist = Infinity;
  for (const item of CAIRO_GIZA_CATALOG) {
    const d = approxDistanceKm(lat, lng, item.latitude, item.longitude);
    if (d < minDist) {
      minDist = d;
      closest = item;
    }
  }
  // Return closest if within 8 km
  return minDist < 8 ? closest : null;
}

function isValidLatLong(lat: number, lng: number): boolean {
  return !Number.isNaN(lat) && !Number.isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function roundCoord(num: number): number {
  return Math.round(num * 1_000_000) / 1_000_000;
}

const OLC_ALPHABET = '23456789CFGHJMPQRVWX';
const OLC_SEPARATOR = '+';
const OLC_SEPARATOR_POSITION = 8;

/**
 * Decodes a full 10- or 11-character Open Location Code (Plus Code) into { latitude, longitude }.
 */
function decodeFullOpenLocationCode(code: string): Coordinates | null {
  const cleanCode = code.replace('+', '').toUpperCase();
  if (cleanCode.length < 8) return null;

  let lat = -90;
  let lng = -180;
  let latRes = 20;
  let lngRes = 20;

  for (let i = 0; i < 8 && i < cleanCode.length; i += 2) {
    const latIndex = OLC_ALPHABET.indexOf(cleanCode[i]);
    const lngIndex = OLC_ALPHABET.indexOf(cleanCode[i + 1]);
    if (latIndex < 0 || lngIndex < 0) return null;
    lat += latIndex * latRes;
    lng += lngIndex * lngRes;
    latRes /= 20;
    lngRes /= 20;
  }

  if (cleanCode.length >= 10) {
    const latIndex = OLC_ALPHABET.indexOf(cleanCode[8]);
    const lngIndex = OLC_ALPHABET.indexOf(cleanCode[9]);
    if (latIndex >= 0 && lngIndex >= 0) {
      lat += latIndex * latRes;
      lng += lngIndex * lngRes;
      latRes /= 20;
      lngRes /= 20;
    }
  }

  if (cleanCode.length > 10) {
    for (let i = 10; i < cleanCode.length; i++) {
      const idx = OLC_ALPHABET.indexOf(cleanCode[i]);
      if (idx < 0) break;
      const r = Math.floor(idx / 4);
      const c = idx % 4;
      lat += r * (latRes / 5);
      lng += c * (lngRes / 4);
      latRes /= 5;
      lngRes /= 4;
    }
  }

  return {
    latitude: Math.round((lat + latRes / 2) * 1_000_000) / 1_000_000,
    longitude: Math.round((lng + lngRes / 2) * 1_000_000) / 1_000_000,
  };
}

/**
 * Recovers a short Open Location Code (Plus Code, e.g. "244R+Q92") relative to a reference coordinate in Cairo/Giza.
 */
export function decodePlusCode(shortCode: string, refLat = 30.0444, refLng = 31.2357): Coordinates | null {
  const code = shortCode.trim().toUpperCase();
  const sepIdx = code.indexOf(OLC_SEPARATOR);
  if (sepIdx < 0) return null;

  const paddingChars = OLC_SEPARATOR_POSITION - sepIdx;
  if (paddingChars <= 0) {
    return decodeFullOpenLocationCode(code);
  }

  let latVal = refLat + 90;
  let lngVal = refLng + 180;
  let prefix = '';
  let latRes = 20;
  let lngRes = 20;

  for (let i = 0; i < paddingChars; i += 2) {
    const latDigit = Math.floor(latVal / latRes);
    const lngDigit = Math.floor(lngVal / lngRes);
    prefix += OLC_ALPHABET[latDigit] + OLC_ALPHABET[lngDigit];
    latVal -= latDigit * latRes;
    lngVal -= lngDigit * lngRes;
    latRes /= 20;
    lngRes /= 20;
  }

  const candidate = prefix + code;
  const decoded = decodeFullOpenLocationCode(candidate);
  if (!decoded) return null;

  const step = latRes * 20;
  let bestLat = decoded.latitude;
  let bestLng = decoded.longitude;
  let minDist = Math.hypot(bestLat - refLat, bestLng - refLng);

  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      const testLat = decoded.latitude + dLat * step;
      const testLng = decoded.longitude + dLng * step;
      const dist = Math.hypot(testLat - refLat, testLng - refLng);
      if (dist < minDist) {
        minDist = dist;
        bestLat = testLat;
        bestLng = testLng;
      }
    }
  }

  return {
    latitude: Math.round(bestLat * 1_000_000) / 1_000_000,
    longitude: Math.round(bestLng * 1_000_000) / 1_000_000,
  };
}

/**
 * Parses coordinates from user input, Google Maps URLs, Plus Codes, or WhatsApp shares.
 * Supports:
 * - Google Plus Codes (Open Location Code): "244R+Q92, Atati, Al Haram, Giza Governorate 3553272", "8G2H244R+Q92"
 * - Plain decimal: "30.0386, 31.2122", "30.0386 31.2122", "٣٠.٠٣٨٦ ، ٣١.٢١٢٢"
 * - Google Maps URLs: https://www.google.com/maps/@30.0386,31.2122 or ?q=30.0386,31.2122
 * - Degrees Minutes Seconds (DMS): 30°02'19.0"N 31°12'43.9"E
 * - Geo URI scheme: "geo:30.0386,31.2122"
 */
export function parseCoordinatesInput(rawInput: string): Coordinates | null {
  if (!rawInput || typeof rawInput !== 'string') return null;

  // Convert Eastern Arabic numerals (٠-٩) to Western (0-9) and Arabic comma (،) to standard comma
  const str = rawInput
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/،/g, ',');

  if (!str) return null;

  // 1. Google Plus Code (Open Location Code) e.g. "244R+Q92" in "244R+Q92, Atati, Al Haram, Giza Governorate 3553272"
  const plusMatch = str.match(/\b([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,4})\b/i);
  if (plusMatch) {
    let refLat = 30.0444;
    let refLng = 31.2357;
    const lower = str.toLowerCase();
    if (lower.includes('haram') || lower.includes('هرم')) {
      refLat = 29.9972;
      refLng = 31.1558;
    } else if (lower.includes('october') || lower.includes('اكتوبر') || lower.includes('zayed') || lower.includes('زايد')) {
      refLat = 29.9737;
      refLng = 30.9481;
    } else if (lower.includes('maadi') || lower.includes('معادي')) {
      refLat = 29.9602;
      refLng = 31.2569;
    } else if (lower.includes('new cairo') || lower.includes('تجمع') || lower.includes('tagamoa')) {
      refLat = 30.0131;
      refLng = 31.4289;
    }

    const decoded = decodePlusCode(plusMatch[1], refLat, refLng);
    if (decoded && isValidLatLong(decoded.latitude, decoded.longitude)) {
      return decoded;
    }
  }

  // 2. Google Maps @lat,lng in URL (e.g. /@30.038611,31.212222,17z)
  const atMatch = str.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (isValidLatLong(lat, lng)) {
      return { latitude: roundCoord(lat), longitude: roundCoord(lng) };
    }
  }

  // 3. Query param or Geo URI (e.g. ?q=30.0386,31.2122, ?q=loc:30.0386,31.2122, ?ll=30.0386,31.2122, geo:30.0386,31.2122)
  const queryMatch = str.match(/(?:[?&](?:q|query|ll|loc)=(?:loc:)?|geo:)(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/i);
  if (queryMatch) {
    const lat = parseFloat(queryMatch[1]);
    const lng = parseFloat(queryMatch[2]);
    if (isValidLatLong(lat, lng)) {
      return { latitude: roundCoord(lat), longitude: roundCoord(lng) };
    }
  }

  // 4. DMS (Degrees Minutes Seconds) e.g. 30°02'19.0"N 31°12'43.9"E or 30°2'19"N, 31°12'44"E
  const dmsMatch = str.match(
    /(\d+)[°\s]+(\d+)['\s]+(\d+(?:\.\d+)?)["]?\s*([NSns])[,\s]+(\d+)[°\s]+(\d+)['\s]+(\d+(?:\.\d+)?)["]?\s*([EWew])/i
  );
  if (dmsMatch) {
    let lat = parseInt(dmsMatch[1], 10) + parseInt(dmsMatch[2], 10) / 60 + parseFloat(dmsMatch[3]) / 3600;
    if (dmsMatch[4].toUpperCase() === 'S') lat = -lat;
    let lng = parseInt(dmsMatch[5], 10) + parseInt(dmsMatch[6], 10) / 60 + parseFloat(dmsMatch[7]) / 3600;
    if (dmsMatch[8].toUpperCase() === 'W') lng = -lng;
    if (isValidLatLong(lat, lng)) {
      return { latitude: roundCoord(lat), longitude: roundCoord(lng) };
    }
  }

  // 5. Decimal degrees with directional suffix (e.g. 30.0386° N, 31.2122° E or 30.0386 N, 31.2122 E)
  const degDirMatch = str.match(
    /(-?\d+(?:\.\d+)?)[°\s]*([NSns])[,\s]+(-?\d+(?:\.\d+)?)[°\s]*([EWew])/i
  );
  if (degDirMatch) {
    let lat = parseFloat(degDirMatch[1]);
    if (degDirMatch[2].toUpperCase() === 'S') lat = -Math.abs(lat);
    let lng = parseFloat(degDirMatch[3]);
    if (degDirMatch[4].toUpperCase() === 'W') lng = -Math.abs(lng);
    if (isValidLatLong(lat, lng)) {
      return { latitude: roundCoord(lat), longitude: roundCoord(lng) };
    }
  }

  // 6. Standard decimal lat, lng (e.g. "30.0386, 31.2122", "30.0386,31.2122", "30.0386 31.2122")
  const plainMatch = str.match(/(-?\d{1,2}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/);
  if (plainMatch) {
    const lat = parseFloat(plainMatch[1]);
    const lng = parseFloat(plainMatch[2]);
    if (isValidLatLong(lat, lng)) {
      return { latitude: roundCoord(lat), longitude: roundCoord(lng) };
    }
  }

  return null;
}

/**
 * Real-time address and landmark search across Cairo & Giza.
 * Integrates local catalog matching, Mapbox Geocoding Places v5 with Egypt bounding box,
 * and graceful fallback.
 */
export async function searchPlaces(
  query: string,
  options?: {
    locale?: string;
    token?: string;
    signal?: AbortSignal;
  },
): Promise<SearchResultItem[]> {
  const q = query.trim();
  if (!q) return [];

  const isAr = (options?.locale || 'ar').startsWith('ar');

  // 0. Instant coordinate extraction (Google Maps URLs, decimal coords, DMS)
  const parsedCoord = parseCoordinatesInput(q);
  if (parsedCoord) {
    const isInside = isInsideServiceArea(parsedCoord.latitude, parsedCoord.longitude);
    const nearest = findNearestCatalogItem(parsedCoord.latitude, parsedCoord.longitude);
    const gov = determineGovernorate(parsedCoord.latitude, parsedCoord.longitude);
    const areaName = nearest
      ? (isAr ? nearest.areaAr : nearest.areaEn)
      : (isAr ? 'موقع محدد بالإحداثيات' : 'Location by coordinates');

    const coordResult: SearchResultItem = {
      id: `coord-${parsedCoord.latitude}-${parsedCoord.longitude}`,
      name: isAr
        ? `إحداثيات خرائط جوجل (${parsedCoord.latitude.toFixed(5)}, ${parsedCoord.longitude.toFixed(5)})`
        : `Google Maps coordinates (${parsedCoord.latitude.toFixed(5)}, ${parsedCoord.longitude.toFixed(5)})`,
      secondary: isInside
        ? (isAr
            ? `${areaName}، ${gov === 'Cairo' ? 'محافظة القاهرة' : 'محافظة الجيزة'} (داخل نطاق التوصيل)`
            : `${areaName}, ${gov} (Within delivery area)`)
        : (isAr
            ? 'خارج نطاق تغطية القاهرة والجيزة'
            : 'Outside Cairo & Giza delivery area'),
      coordinates: parsedCoord,
      governorate: gov,
      area: areaName,
      category: 'address',
      source: 'provider',
    };

    return [coordResult];
  }

  const normQ = normaliseArabicSearch(q);

  // 1. Instant local catalog matches
  const catalogMatches: SearchResultItem[] = [];
  for (const item of CAIRO_GIZA_CATALOG) {
    const normAr = normaliseArabicSearch(item.nameAr);
    const normEn = item.nameEn.toLowerCase();
    const matchesKeyword = item.keywords.some((k) =>
      normaliseArabicSearch(k).includes(normQ) || normQ.includes(normaliseArabicSearch(k)),
    );
    if (normAr.includes(normQ) || normEn.includes(normQ) || matchesKeyword) {
      catalogMatches.push({
        id: item.id,
        name: isAr ? item.nameAr : item.nameEn,
        secondary: isAr
          ? `${item.areaAr}، ${item.governorate === 'Cairo' ? 'محافظة القاهرة' : 'محافظة الجيزة'}`
          : `${item.areaEn}, ${item.governorate}`,
        coordinates: { latitude: item.latitude, longitude: item.longitude },
        governorate: item.governorate,
        area: isAr ? item.areaAr : item.areaEn,
        category: item.category === 'landmark' ? 'landmark' : 'neighborhood',
        source: 'catalog',
      });
    }
  }

  // 2. Mapbox Places v5 geocoding if token is available
  const token = options?.token || (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN : undefined);
  if (token && token.trim() && q.length >= 2) {
    try {
      const bbox = `${SERVICE_AREA_BOUNDS.minLng},${SERVICE_AREA_BOUNDS.minLat},${SERVICE_AREA_BOUNDS.maxLng},${SERVICE_AREA_BOUNDS.maxLat}`;
      const lang = isAr ? 'ar' : 'en';
      const encoded = encodeURIComponent(q);
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&country=eg&bbox=${bbox}&proximity=31.2357,30.0444&language=${lang}&types=address,poi,neighborhood,locality,place`;

      const response = await fetch(url, { signal: options?.signal });
      if (response.ok) {
        const data = await response.json();
        const providerResults: SearchResultItem[] = [];

        if (Array.isArray(data.features)) {
          for (const feature of data.features) {
            if (!feature.center || feature.center.length < 2) continue;
            const lng = feature.center[0];
            const lat = feature.center[1];

            // Confirm deliverable bounds
            if (!isInsideServiceArea(lat, lng)) continue;

            // Extract context
            let regionName = '';
            let localityName = '';
            if (Array.isArray(feature.context)) {
              for (const ctx of feature.context) {
                if (typeof ctx.id === 'string') {
                  if (ctx.id.startsWith('region')) regionName = ctx.text_ar || ctx.text || '';
                  if (ctx.id.startsWith('locality') || ctx.id.startsWith('place')) {
                    if (!localityName) localityName = ctx.text_ar || ctx.text || '';
                  }
                }
              }
            }

            const gov = determineGovernorate(lat, lng, regionName);
            const mainName = feature.text_ar || feature.text || feature.place_name_ar || feature.place_name || q;
            const fullPlace = feature.place_name_ar || feature.place_name || '';

            // Clean up secondary line
            let secondary = fullPlace.replace(mainName, '').replace(/^[\s,،]+/, '').trim();
            if (!secondary) {
              secondary = isAr
                ? `${localityName || mainName}، ${gov === 'Cairo' ? 'القاهرة' : 'الجيزة'}`
                : `${localityName || mainName}, ${gov}`;
            }

            providerResults.push({
              id: feature.id || `mb-${lat}-${lng}`,
              name: mainName,
              secondary,
              coordinates: {
                latitude: Math.round(lat * 1_000_000) / 1_000_000,
                longitude: Math.round(lng * 1_000_000) / 1_000_000,
              },
              governorate: gov,
              area: localityName || mainName,
              category: feature.place_type?.includes('poi') ? 'landmark' : 'address',
              source: 'provider',
            });
          }
        }

        // Merge catalog matches and provider results, deduplicating by coordinates
        const combined = [...catalogMatches];
        for (const pr of providerResults) {
          const isDupe = combined.some(
            (c) =>
              approxDistanceKm(c.coordinates.latitude, c.coordinates.longitude, pr.coordinates.latitude, pr.coordinates.longitude) < 0.25,
          );
          if (!isDupe) combined.push(pr);
        }
        return combined.slice(0, 8);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      // On network failure, fallback gracefully to catalog matches
    }
  }

  return catalogMatches.slice(0, 8);
}

/**
 * Reverse geocodes coordinates to a clean, structured address suggestion
 * (Governorate, Area, Street, Full Display).
 */
export async function reverseGeocode(
  coordinates: Coordinates,
  options?: {
    locale?: string;
    token?: string;
    signal?: AbortSignal;
  },
): Promise<GeocodedAddressSuggestion | null> {
  const { latitude: lat, longitude: lng } = coordinates;
  const isDeliverable = isInsideServiceArea(lat, lng) && !isDefaultCentre(lat, lng);

  const isAr = (options?.locale || 'ar').startsWith('ar');
  const token = options?.token || (typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN : undefined);

  if (token && token.trim()) {
    try {
      const lang = isAr ? 'ar' : 'en';
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&language=${lang}&types=address,poi,neighborhood,locality,place`;
      const response = await fetch(url, { signal: options?.signal });

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.features) && data.features.length > 0) {
          const first = data.features[0];
          let regionName = '';
          let localityName = '';
          let streetAddress = first.text_ar || first.text || '';
          const addressNumber = first.address ? String(first.address).trim() : '';

          if (Array.isArray(first.context)) {
            for (const ctx of first.context) {
              if (typeof ctx.id === 'string') {
                if (ctx.id.startsWith('region')) regionName = ctx.text_ar || ctx.text || '';
                if (ctx.id.startsWith('locality') || ctx.id.startsWith('place')) {
                  if (!localityName) localityName = ctx.text_ar || ctx.text || '';
                }
              }
            }
          }

          const gov = determineGovernorate(lat, lng, regionName);
          const nearestCatalog = findNearestCatalogItem(lat, lng);
          const area = localityName || (nearestCatalog ? (isAr ? nearestCatalog.areaAr : nearestCatalog.areaEn) : (gov === 'Cairo' ? 'القاهرة' : 'الجيزة'));

          if (addressNumber && streetAddress) {
            streetAddress = `${streetAddress} ${addressNumber}`;
          }

          const fullFormatted = first.place_name_ar || first.place_name || [streetAddress, area, gov].filter(Boolean).join('، ');

          return {
            governorate: gov,
            area,
            streetAddress: streetAddress || area,
            building: addressNumber || undefined,
            fullFormatted,
            isInsideServiceArea: isDeliverable,
            source: 'provider',
          };
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      // Fallback
    }
  }

  // Graceful fallback from nearest catalog item
  const nearest = findNearestCatalogItem(lat, lng);
  if (nearest) {
    const gov = determineGovernorate(lat, lng);
    const area = isAr ? nearest.areaAr : nearest.areaEn;
    const name = isAr ? nearest.nameAr : nearest.nameEn;
    return {
      governorate: gov,
      area,
      streetAddress: name,
      fullFormatted: isAr ? `${name}، ${area}، ${gov === 'Cairo' ? 'محافظة القاهرة' : 'محافظة الجيزة'}` : `${name}, ${area}, ${gov}`,
      isInsideServiceArea: isDeliverable,
      source: 'catalog',
    };
  }

  const gov = determineGovernorate(lat, lng);
  const fallbackArea = gov === 'Cairo' ? (isAr ? 'القاهرة' : 'Cairo') : (isAr ? 'الجيزة' : 'Giza');
  return {
    governorate: gov,
    area: fallbackArea,
    streetAddress: '',
    fullFormatted: isAr ? `موقع محدد، ${fallbackArea}` : `Pinned location, ${fallbackArea}`,
    isInsideServiceArea: isDeliverable,
    source: 'fallback',
  };
}
