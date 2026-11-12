import {
  searchPlaces,
  reverseGeocode,
  determineGovernorate,
  normaliseArabicSearch,
  findNearestCatalogItem,
  CAIRO_GIZA_CATALOG,
} from './location-service';
import { isInsideServiceArea, isDefaultCentre } from './service-area';

describe('Location Service - Cairo & Giza Precision Search & Geocoding', () => {
  describe('normaliseArabicSearch', () => {
    it('normalises different forms of alef, taa marbuta, and yaa', () => {
      expect(normaliseArabicSearch('القاهرة')).toBe('القاهره');
      expect(normaliseArabicSearch('إمبابة')).toBe('امبابه');
      expect(normaliseArabicSearch('المهندسين')).toBe('المهندسين');
      expect(normaliseArabicSearch('دُقِّي')).toBe('دقي');
    });

    it('converts Arabic-Indic digits to Western digits for search matching', () => {
      expect(normaliseArabicSearch('٦ أكتوبر')).toBe('6 اكتوبر');
    });
  });

  describe('determineGovernorate', () => {
    it('correctly maps raw region strings to Cairo or Giza', () => {
      expect(determineGovernorate(30.0444, 31.2357, 'محافظة القاهرة')).toBe('Cairo');
      expect(determineGovernorate(30.0386, 31.2122, 'Giza Governorate')).toBe('Giza');
      expect(determineGovernorate(30.0488, 30.9856, 'EG-GZ')).toBe('Giza');
      expect(determineGovernorate(29.9602, 31.2569, 'EG-C')).toBe('Cairo');
    });

    it('uses geographical coordinates when region string is missing or ambiguous', () => {
      // 6th of October (lng 30.9529) -> Giza
      expect(determineGovernorate(29.9737, 30.9529)).toBe('Giza');
      // Sheikh Zayed (lng 30.9856) -> Giza
      expect(determineGovernorate(30.0488, 30.9856)).toBe('Giza');
      // Dokki (lng 31.2122) -> Giza
      expect(determineGovernorate(30.0386, 31.2122)).toBe('Giza');
      // Mohandessin (lng 31.2003) -> Giza
      expect(determineGovernorate(30.0511, 31.2003)).toBe('Giza');
      // Maadi (lng 31.2569) -> Cairo
      expect(determineGovernorate(29.9602, 31.2569)).toBe('Cairo');
      // New Cairo (lng 31.4289) -> Cairo
      expect(determineGovernorate(30.0131, 31.4289)).toBe('Cairo');
      // Nasr City (lng 31.3301) -> Cairo
      expect(determineGovernorate(30.0561, 31.3301)).toBe('Cairo');
      // Heliopolis (lng 31.3285) -> Cairo
      expect(determineGovernorate(30.0898, 31.3285)).toBe('Cairo');
    });
  });

  describe('CAIRO_GIZA_CATALOG', () => {
    it('ensures every catalog entry is inside the service area and not a rejected default centre', () => {
      for (const item of CAIRO_GIZA_CATALOG) {
        expect(isInsideServiceArea(item.latitude, item.longitude)).toBe(true);
        expect(isDefaultCentre(item.latitude, item.longitude)).toBe(false);
        expect(['Cairo', 'Giza']).toContain(item.governorate);
        expect(item.nameAr.length).toBeGreaterThan(0);
        expect(item.nameEn.length).toBeGreaterThan(0);
      }
    });

    it('finds nearest catalog item for a given point', () => {
      // Point close to Dokki
      const dokkiNear = findNearestCatalogItem(30.039, 31.213);
      expect(dokkiNear).not.toBeNull();
      expect(dokkiNear?.governorate).toBe('Giza');
      expect(dokkiNear?.id).toBe('giza-dokki');

      // Point close to Maadi
      const maadiNear = findNearestCatalogItem(29.961, 31.258);
      expect(maadiNear).not.toBeNull();
      expect(maadiNear?.governorate).toBe('Cairo');
      expect(maadiNear?.id).toBe('cairo-maadi');
    });
  });

  describe('searchPlaces', () => {
    it('returns relevant results for Arabic searches in Cairo & Giza', async () => {
      const resultsMaadi = await searchPlaces('المعادي', { locale: 'ar' });
      expect(resultsMaadi.length).toBeGreaterThan(0);
      expect(resultsMaadi[0].name).toContain('المعادي');
      expect(resultsMaadi[0].governorate).toBe('Cairo');

      const resultsDokki = await searchPlaces('الدقي', { locale: 'ar' });
      expect(resultsDokki.length).toBeGreaterThan(0);
      expect(resultsDokki[0].name).toContain('الدقي');
      expect(resultsDokki[0].governorate).toBe('Giza');

      const resultsZayed = await searchPlaces('الشيخ زايد', { locale: 'ar' });
      expect(resultsZayed.length).toBeGreaterThan(0);
      expect(resultsZayed[0].governorate).toBe('Giza');
    });

    it('returns relevant results for English searches', async () => {
      const resultsNasrCity = await searchPlaces('Nasr City', { locale: 'en' });
      expect(resultsNasrCity.length).toBeGreaterThan(0);
      expect(resultsNasrCity[0].name).toBe('Nasr City');
      expect(resultsNasrCity[0].governorate).toBe('Cairo');

      const resultsZamalek = await searchPlaces('Zamalek', { locale: 'en' });
      expect(resultsZamalek.length).toBeGreaterThan(0);
      expect(resultsZamalek[0].name).toBe('Zamalek');
      expect(resultsZamalek[0].governorate).toBe('Cairo');
    });

    it('matches landmarks by keywords (e.g. Cairo Tower, Mall of Egypt, CFC)', async () => {
      const cairoTower = await searchPlaces('برج القاهرة', { locale: 'ar' });
      expect(cairoTower.length).toBeGreaterThan(0);
      expect(cairoTower[0].name).toBe('برج القاهرة');

      const mallOfEgypt = await searchPlaces('مول مصر', { locale: 'ar' });
      expect(mallOfEgypt.length).toBeGreaterThan(0);
      expect(mallOfEgypt[0].governorate).toBe('Giza');
    });

    it('returns empty array on blank query without making external requests', async () => {
      const res = await searchPlaces('   ');
      expect(res).toEqual([]);
    });
  });

  describe('reverseGeocode', () => {
    it('reverse geocodes coordinates to a deliverable suggested address in Dokki', async () => {
      const res = await reverseGeocode({ latitude: 30.0386, longitude: 31.2122 }, { locale: 'ar' });
      expect(res).not.toBeNull();
      expect(res?.isInsideServiceArea).toBe(true);
      expect(res?.governorate).toBe('Giza');
      expect(res?.area).toBeTruthy();
    });

    it('reverse geocodes coordinates to a deliverable suggested address in Maadi', async () => {
      const res = await reverseGeocode({ latitude: 29.9602, longitude: 31.2569 }, { locale: 'ar' });
      expect(res).not.toBeNull();
      expect(res?.isInsideServiceArea).toBe(true);
      expect(res?.governorate).toBe('Cairo');
    });

    it('marks points outside Cairo & Giza as not inside service area', async () => {
      // Alexandria
      const resAlex = await reverseGeocode({ latitude: 31.2001, longitude: 29.9187 }, { locale: 'ar' });
      expect(resAlex?.isInsideServiceArea).toBe(false);
    });

    it('marks rejected default centres as not deliverable', async () => {
      // Tahrir exact default center
      const resTahrir = await reverseGeocode({ latitude: 30.0444, longitude: 31.2357 }, { locale: 'ar' });
      expect(resTahrir?.isInsideServiceArea).toBe(false);
    });
  });
});
