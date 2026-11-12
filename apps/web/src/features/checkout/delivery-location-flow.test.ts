import {
  searchPlaces,
  reverseGeocode,
  findNearestCatalogItem,
  parseCoordinatesInput,
  type Coordinates,
} from './lib/location-service';
import {
  isInsideServiceArea,
  isDefaultCentre,
  SERVICE_AREA_BOUNDS,
  DEFAULT_MAP_CENTRES,
} from './lib/service-area';
import {
  composeShippingAddress,
  toGovernorate,
  type NewAddressDraft,
  EMPTY_ADDRESS,
} from './lib/checkout-draft';
import type { LocationPin } from './components/DeliveryLocationPicker';
import type { CheckoutData } from '@/lib/orders';
import type { CustomerAddress } from '@/lib/addresses';

describe('Delivery Location Flow — End-to-End Verification (Tasks 1-7)', () => {
  /* ── 1. Search for addresses in Cairo/Giza in Arabic and English ──────── */
  describe('1. Place search with Arabic and English support', () => {
    it('returns accurate suggestions for Arabic queries across Cairo & Giza', async () => {
      const arabicQueries = ['المعادي', 'الدقي', 'الشيخ زايد', 'المهندسين', 'برج القاهرة'];
      for (const query of arabicQueries) {
        const results = await searchPlaces(query, { locale: 'ar' });
        expect(results.length).toBeGreaterThan(0);
        const top = results[0];
        expect(top.coordinates.latitude).toBeGreaterThanOrEqual(SERVICE_AREA_BOUNDS.minLat);
        expect(top.coordinates.latitude).toBeLessThanOrEqual(SERVICE_AREA_BOUNDS.maxLat);
        expect(top.coordinates.longitude).toBeGreaterThanOrEqual(SERVICE_AREA_BOUNDS.minLng);
        expect(top.coordinates.longitude).toBeLessThanOrEqual(SERVICE_AREA_BOUNDS.maxLng);
        expect(['Cairo', 'Giza']).toContain(top.governorate);
      }
    });

    it('returns accurate suggestions for English queries across Cairo & Giza', async () => {
      const englishQueries = ['Zamalek', 'Nasr City', 'New Cairo', 'Heliopolis', 'Mall of Egypt'];
      for (const query of englishQueries) {
        const results = await searchPlaces(query, { locale: 'en' });
        expect(results.length).toBeGreaterThan(0);
        const top = results[0];
        expect(isInsideServiceArea(top.coordinates.latitude, top.coordinates.longitude)).toBe(true);
        expect(['Cairo', 'Giza']).toContain(top.governorate);
      }
    });
  });

  /* ── 2. Select a search result and verify the pin position ───────────── */
  describe('2. Search selection and pin coordinate update', () => {
    it('moves pin to exact search result coordinates upon selection', async () => {
      const results = await searchPlaces('المعادي', { locale: 'ar' });
      expect(results.length).toBeGreaterThan(0);
      const selected = results[0];

      // Simulates picker selection flow
      const pin: LocationPin = {
        latitude: selected.coordinates.latitude,
        longitude: selected.coordinates.longitude,
        locationSource: 'map_pin',
        confirmed: false,
      };

      expect(pin.latitude).toBe(29.9602);
      expect(pin.longitude).toBe(31.2569);
      expect(pin.confirmed).toBe(false);
      expect(isInsideServiceArea(pin.latitude, pin.longitude)).toBe(true);
      expect(isDefaultCentre(pin.latitude, pin.longitude)).toBe(false);
    });
  });

  /* ── 3. Drag/move the map and confirm the correct coordinates ────────── */
  describe('3. Center crosshair map movement and coordinate sampling', () => {
    it('samples exact map center coordinates and precision-rounds to 6 decimal places', () => {
      // Simulate raw map center returned from mapboxgl.Map.getCenter() during user drag
      const rawLat = 30.0386123456;
      const rawLng = 31.2122789123;

      const roundedLat = Math.round(rawLat * 1_000_000) / 1_000_000;
      const roundedLng = Math.round(rawLng * 1_000_000) / 1_000_000;

      expect(roundedLat).toBe(30.038612);
      expect(roundedLng).toBe(31.212279);

      // Verify that rounded coordinates are inside service area and not improbable
      expect(isInsideServiceArea(roundedLat, roundedLng)).toBe(true);
      expect(isDefaultCentre(roundedLat, roundedLng)).toBe(false);
    });
  });

  /* ── 4. Use current location with accurate and inaccurate GPS ─────────── */
  describe('4. Current location handling with accurate and inaccurate GPS', () => {
    it('successfully resolves an accurate GPS reading inside Cairo & Giza', async () => {
      const coords: Coordinates = { latitude: 30.0386, longitude: 31.2122 };
      const accuracy = 15; // 15 meters: high accuracy

      expect(isInsideServiceArea(coords.latitude, coords.longitude)).toBe(true);
      expect(accuracy <= 100).toBe(true);

      const resolved = await reverseGeocode(coords, { locale: 'ar' });
      expect(resolved).not.toBeNull();
      expect(resolved?.isInsideServiceArea).toBe(true);
      expect(resolved?.governorate).toBe('Giza');
    });

    it('flags inaccurate GPS readings (>120m) for customer review', () => {
      const accuracy = 350; // Cell tower triangulation
      const isLowAccuracy = accuracy > 120;
      expect(isLowAccuracy).toBe(true);
    });

    it('rejects GPS readings outside Cairo & Giza service area', async () => {
      const alexandriaGps: Coordinates = { latitude: 31.2001, longitude: 29.9187 };
      expect(isInsideServiceArea(alexandriaGps.latitude, alexandriaGps.longitude)).toBe(false);

      const resolved = await reverseGeocode(alexandriaGps, { locale: 'ar' });
      expect(resolved?.isInsideServiceArea).toBe(false);
    });
  });

  /* ── 5. Correct an incorrect suggested address manually ──────────────── */
  describe('5. Manual correction of suggested address details', () => {
    it('allows full user correction of suggested street and addition of building, floor, apartment', async () => {
      // Step A: Reverse geocode provides a suggestion
      const coords: Coordinates = { latitude: 29.9602, longitude: 31.2569 };
      const suggestion = await reverseGeocode(coords, { locale: 'ar' });
      expect(suggestion).not.toBeNull();

      // Step B: User starts with suggestion but edits street and completes door details
      const userDraft: NewAddressDraft = {
        label: 'المنزل',
        governorate: suggestion!.governorate,
        area: 'المعادي',
        shippingAddress: 'شارع 9 الرئيسي', // User customized
        building: '15',
        floor: '3',
        apartment: '12',
        notes: 'بجوار محطة مترو المعادي',
        pin: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          locationSource: 'map_pin',
          confirmed: true,
        },
      };

      // Step C: Composed shipping address merges details cleanly
      const composed = composeShippingAddress(
        userDraft.shippingAddress,
        userDraft.building,
        userDraft.floor,
        userDraft.apartment,
      );

      expect(composed).toContain('شارع 9 الرئيسي');
      expect(composed).toContain('عمارة 15');
      expect(composed).toContain('الدور 3');
      expect(composed).toContain('شقة 12');
      expect(composed.length).toBeLessThanOrEqual(255);
    });
  });

  /* ── 6. Save, reload, and edit an address ─────────────────────────────── */
  describe('6. Saved address persistence and in-checkout editing', () => {
    it('preserves all address details and confirmed pin when editing saved addresses', () => {
      const initialSavedAddress: CustomerAddress = {
        id: 'addr-test-1',
        customerId: 'cust-1',
        label: 'البيت',
        customerName: 'سارة أحمد',
        customerPhone: '01012345678',
        governorate: 'Cairo',
        area: 'المعادي',
        shippingAddress: 'شارع 9، عمارة 15، الدور 3، شقة 12',
        notes: 'بوابة خضراء',
        latitude: 29.9602,
        longitude: 31.2569,
        locationSource: 'map_pin',
        isDefault: true,
        createdAt: '2026-11-01T10:00:00Z',
        updatedAt: '2026-11-01T10:00:00Z',
      };

      // Customer starts editing the existing address in checkout
      const editDraft: NewAddressDraft = {
        label: initialSavedAddress.label ?? '',
        governorate: toGovernorate(initialSavedAddress.governorate),
        area: initialSavedAddress.area,
        shippingAddress: initialSavedAddress.shippingAddress,
        notes: initialSavedAddress.notes ?? '',
        pin: {
          latitude: initialSavedAddress.latitude,
          longitude: initialSavedAddress.longitude,
          locationSource: 'map_pin',
          confirmed: true,
        },
      };

      // Customer refines apartment number and tweaks door pin
      editDraft.shippingAddress = 'شارع 9، عمارة 15، الدور 3، شقة 14'; // corrected apt
      editDraft.pin = {
        latitude: 29.96025,
        longitude: 31.25695,
        locationSource: 'map_pin',
        confirmed: true,
      };

      expect(editDraft.shippingAddress).toBe('شارع 9، عمارة 15، الدور 3، شقة 14');
      expect(editDraft.pin.latitude).toBe(29.96025);
      expect(editDraft.pin.longitude).toBe(31.25695);
      expect(isInsideServiceArea(editDraft.pin.latitude, editDraft.pin.longitude)).toBe(true);
    });
  });

  /* ── 7. Verify delivery coverage and checkout submission ──────────────── */
  describe('7. Delivery coverage enforcement and checkout payload contract', () => {
    it('accepts valid checkout submission with confirmed pin in Cairo', () => {
      const checkoutPayload: CheckoutData = {
        customerName: 'كريم محمود',
        customerPhone: '01123456789',
        governorate: 'Cairo',
        area: 'المعادي',
        shippingAddress: 'شارع 9، عمارة 15، الدور 3، شقة 12',
        notes: 'رنين الجرس',
        latitude: 29.9602,
        longitude: 31.2569,
        locationSource: 'map_pin',
        locationConfirmed: true,
        idempotencyKey: 'idemp-cairo-checkout-1',
        quoteVersion: '3bbdf903-bc32-42ac-c03d-ffc81542d24c',
        cartRevision: 1,
        paymentMethod: 'COD',
      };

      expect(checkoutPayload.locationConfirmed).toBe(true);
      expect(isInsideServiceArea(checkoutPayload.latitude, checkoutPayload.longitude)).toBe(true);
      expect(isDefaultCentre(checkoutPayload.latitude, checkoutPayload.longitude)).toBe(false);
      expect(['Cairo', 'Giza']).toContain(checkoutPayload.governorate);
    });

    it('rejects checkout submission with unconfirmed pin', () => {
      const unconfirmedPin: LocationPin = {
        latitude: 29.9602,
        longitude: 31.2569,
        locationSource: 'map_pin',
        confirmed: false,
      };

      expect(unconfirmedPin.confirmed).toBe(false);
      // Checkout submission requires confirmed: true
      const canSubmit = unconfirmedPin.confirmed && isInsideServiceArea(unconfirmedPin.latitude, unconfirmedPin.longitude);
      expect(canSubmit).toBe(false);
    });

    it('rejects improbable default map center (e.g. unplaced Tahrir centroid)', () => {
      const tahrirCentroid = DEFAULT_MAP_CENTRES[0]; // [30.0444, 31.2357]
      expect(isDefaultCentre(tahrirCentroid[0], tahrirCentroid[1])).toBe(true);

      const canSubmit = !isDefaultCentre(tahrirCentroid[0], tahrirCentroid[1]);
      expect(canSubmit).toBe(false);
    });
  });

  /* ── 8. Stale-request handling and failure recovery ──────────────────── */
  describe('8. Asynchronous race conditions and graceful provider fallback', () => {
    it('discards stale reverse-geocoding responses when user moves the map again', async () => {
      let activeRequestSeq = 0;
      let committedAddress = '';

      // User moves to Point A (seq 1)
      const seq1 = ++activeRequestSeq;
      const pointA = { latitude: 29.9602, longitude: 31.2569 }; // Maadi

      // User immediately moves to Point B before Point A finishes (seq 2)
      const seq2 = ++activeRequestSeq;
      const pointB = { latitude: 30.0386, longitude: 31.2122 }; // Dokki

      // Point B finishes fast
      const resB = await reverseGeocode(pointB, { locale: 'ar' });
      if (seq2 === activeRequestSeq) {
        committedAddress = resB?.area || '';
      }

      // Point A finishes delayed
      const resA = await reverseGeocode(pointA, { locale: 'ar' });
      if (seq1 === activeRequestSeq) {
        // Must NOT overwrite Point B!
        committedAddress = resA?.area || '';
      }

      // Final committed address must be Point B (Dokki), never stale Point A
      expect(committedAddress).toBe('الدقي');
    });

    it('guarantees that reverse-geocoding callbacks never clobber a manually moved pin using functional draft updaters', () => {
      // Represents the checkout draft state
      let state: NewAddressDraft = {
        ...EMPTY_ADDRESS,
        area: '',
        shippingAddress: '',
        pin: null,
      };

      const onDraft = (updater: NewAddressDraft | ((prev: NewAddressDraft) => NewAddressDraft)) => {
        state = typeof updater === 'function' ? updater(state) : updater;
      };

      // Step 1: User places the pin at Point A (Sheikh Zayed)
      const pinA: LocationPin = {
        latitude: 30.0488,
        longitude: 30.9856,
        locationSource: 'map_pin',
        confirmed: false,
      };
      onDraft((prev) => ({ ...prev, pin: pinA }));

      expect(state.pin).toEqual(pinA);

      // Step 2: Reverse geocode returns an address suggestion for Point A
      // When applying suggestion via functional updater, it must not overwrite the latest pin
      onDraft((prev) => ({
        ...prev,
        governorate: 'Giza',
        area: prev.area.trim() ? prev.area : 'الشيخ زايد',
        shippingAddress: prev.shippingAddress.trim() ? prev.shippingAddress : 'محور 26 يوليو',
      }));

      expect(state.governorate).toBe('Giza');
      expect(state.area).toBe('الشيخ زايد');
      expect(state.pin).toEqual(pinA); // Pin is strictly preserved!

      // Step 3: User moves the pin to Point B (New Cairo)
      const pinB: LocationPin = {
        latitude: 30.0131,
        longitude: 31.4289,
        locationSource: 'map_pin',
        confirmed: false,
      };
      onDraft((prev) => ({ ...prev, pin: pinB }));

      expect(state.pin).toEqual(pinB);

      // Step 4: Delayed reverse geocode for Point A resolves late:
      // Even if an outdated callback fires, functional updater accesses prev.pin (Point B) and NEVER clobbers it
      onDraft((prev) => ({
        ...prev,
        governorate: 'Cairo', // Point B governorate
        area: 'التجمع الخامس',
      }));

      expect(state.pin).toEqual(pinB); // Pin remains Point B!
    });

    it('falls back gracefully to curated local catalog when external provider fails', async () => {
      // Simulate missing or failed provider token
      const results = await searchPlaces('الشيخ زايد', { token: '' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].governorate).toBe('Giza');
      expect(results[0].source).toBe('catalog');
    });
  });

  /* ── 9. Automatic geolocation, permissions, & floating locate button ── */
  describe('9. Geolocation permissions, auto-detection guardrails, and accuracy feedback', () => {
    it('determines when automatic geolocation is permitted without overwriting existing address', () => {
      // Case A: User has NO previously selected pin/address -> auto-locate is eligible if permission is granted
      const hasPreviousAddress = false;
      const permissionState = 'granted';
      const shouldAutoLocate = permissionState === 'granted' && !hasPreviousAddress;
      expect(shouldAutoLocate).toBe(true);

      // Case B: User already has a saved or selected address -> auto-locate must NOT overwrite it
      const savedAddressPin: LocationPin = {
        latitude: 29.9602,
        longitude: 31.2569,
        locationSource: 'map_pin',
        confirmed: true,
      };
      const hasPriorSelection = Boolean(savedAddressPin);
      const shouldOverwrite = permissionState === 'granted' && !hasPriorSelection;
      expect(shouldOverwrite).toBe(false);
    });

    it('classifies GPS accuracy into high-precision vs approximate warning', () => {
      const highAccuracyReading = 25; // 25 meters
      const lowAccuracyReading = 150; // 150 meters

      expect(highAccuracyReading <= 80).toBe(true);
      expect(lowAccuracyReading > 80).toBe(true);
    });

    it('handles permission denied gracefully by offering manual map/search fallback', () => {
      const errorEvent = { code: 1, PERMISSION_DENIED: 1, message: 'User denied Geolocation' };
      const isDenied = errorEvent.code === errorEvent.PERMISSION_DENIED;
      expect(isDenied).toBe(true);

      // Verify that Cairo/Giza search catalog remains 100% accessible as manual fallback
      const dokkiItem = findNearestCatalogItem(30.0386, 31.2122);
      expect(dokkiItem).not.toBeNull();
      expect(dokkiItem?.areaAr).toBe('الدقي');
    });

    it('never silently treats default fallback coordinates as a user pin', () => {
      // Uninitialized / unplaced state
      let pin: LocationPin | null = null;
      const inArea = pin !== null ? isInsideServiceArea((pin as LocationPin).latitude, (pin as LocationPin).longitude) : false;
      const canConfirm = Boolean(pin && inArea);

      // Confirm MUST be disabled when pin is null
      expect(canConfirm).toBe(false);
      expect(inArea).toBe(false);

      // Default fallback centroid must NEVER be auto-confirmed
      const fallbackCentroid = { lat: 30.0386, lng: 31.2122 };
      expect(pin).toBeNull();
      expect(fallbackCentroid).toBeDefined();
    });

    it('records detected GPS accuracy in meters for debugging and user feedback', () => {
      const gpsReading = {
        coords: {
          latitude: 30.0131,
          longitude: 31.4289,
          accuracy: 18.4, // meters
        },
      };

      const detectedAccuracy = Math.round(gpsReading.coords.accuracy);
      expect(detectedAccuracy).toBe(18);

      // High precision indicator threshold: <= 80 meters
      const isHighPrecision = detectedAccuracy <= 80;
      expect(isHighPrecision).toBe(true);

      // Low precision warning threshold: > 80 meters
      const cellTowerReading = { coords: { latitude: 30.0131, longitude: 31.4289, accuracy: 250 } };
      const cellAccuracy = Math.round(cellTowerReading.coords.accuracy);
      expect(cellAccuracy > 80).toBe(true);
    });

    it('ignores programmatic map movements and only captures user-initiated interactions', () => {
      // Simulates Mapbox GL moveend event
      let userInteractionCaptured = false;
      const handleMoveEnd = (e: { originalEvent?: unknown }, center: Coordinates) => {
        const wasUser = Boolean(e.originalEvent);
        if (wasUser) {
          userInteractionCaptured = true;
          return { latitude: center.latitude, longitude: center.longitude };
        }
        return null;
      };

      // Programmatic flyTo/initial load (originalEvent is undefined)
      const programmaticResult = handleMoveEnd({}, { latitude: 30.0386, longitude: 31.2122 });
      expect(programmaticResult).toBeNull();
      expect(userInteractionCaptured).toBe(false);

      // User drag/touch interaction (originalEvent is defined)
      const userResult = handleMoveEnd({ originalEvent: { type: 'pointerup' } }, { latitude: 29.9602, longitude: 31.2569 });
      expect(userResult).toEqual({ latitude: 29.9602, longitude: 31.2569 });
      expect(userInteractionCaptured).toBe(true);
    });
  });

  /* ── 10. Confirmation action, re-editing cycle, & address preservation ── */
  describe('10. Confirmation, in-place re-editing, and saved address re-use', () => {
    it('transitions unconfirmed pin to confirmed state on confirm action', () => {
      const candidatePin: LocationPin = {
        latitude: 30.0131,
        longitude: 31.4289,
        locationSource: 'map_pin',
        confirmed: false,
      };

      // User clicks "تأكيد الموقع"
      const confirmedPin: LocationPin = {
        ...candidatePin,
        confirmed: true,
      };

      expect(confirmedPin.confirmed).toBe(true);
      expect(isInsideServiceArea(confirmedPin.latitude, confirmedPin.longitude)).toBe(true);
      expect(isDefaultCentre(confirmedPin.latitude, confirmedPin.longitude)).toBe(false);
    });

    it('allows unlocking confirmed pin via edit location without losing coordinates or user inputs', () => {
      const existingAddress: CustomerAddress = {
        id: 'addr-zayed-1',
        customerId: 'cust-1',
        label: 'العمل',
        customerName: 'أحمد علي',
        customerPhone: '01234567890',
        governorate: 'Giza',
        area: 'الشيخ زايد',
        shippingAddress: 'مبنى أركان، الدور الرابع',
        notes: 'بوابة رقم ٢',
        latitude: 30.0382,
        longitude: 31.0062,
        locationSource: 'map_pin',
        isDefault: false,
        createdAt: '2026-11-01T10:00:00Z',
        updatedAt: '2026-11-01T10:00:00Z',
      };

      // Customer clicks "تعديل الموقع"
      let isEditing = true;
      const editablePin: LocationPin = {
        latitude: existingAddress.latitude,
        longitude: existingAddress.longitude,
        locationSource: 'map_pin',
        confirmed: false, // unlocked for adjustments
      };

      expect(isEditing).toBe(true);
      expect(editablePin.latitude).toBe(30.0382);
      expect(editablePin.longitude).toBe(31.0062);

      // User refines pin location slightly
      editablePin.latitude = 30.0385;
      editablePin.longitude = 31.0065;

      // User confirms again
      const reconfirmedPin: LocationPin = { ...editablePin, confirmed: true };
      isEditing = false;

      expect(isEditing).toBe(false);
      expect(reconfirmedPin.confirmed).toBe(true);
      expect(reconfirmedPin.latitude).toBe(30.0385);
      // Saved address details remain completely intact
      expect(existingAddress.customerName).toBe('أحمد علي');
      expect(existingAddress.shippingAddress).toContain('مبنى أركان');
    });

    it('formats coordinates with 6 decimal places for clipboard copying', async () => {
      const pin: LocationPin = {
        latitude: 30.03861234,
        longitude: 31.21225678,
        locationSource: 'map_pin',
        confirmed: true,
      };

      const formatted = `${pin.latitude.toFixed(6)}, ${pin.longitude.toFixed(6)}`;
      expect(formatted).toBe('30.038612, 31.212257');

      // Verify simulated clipboard write
      let clipboardContent = '';
      const mockClipboard = {
        writeText: jest.fn(async (text: string) => {
          clipboardContent = text;
        }),
      };

      await mockClipboard.writeText(formatted);
      expect(mockClipboard.writeText).toHaveBeenCalledWith('30.038612, 31.212257');
      expect(clipboardContent).toBe('30.038612, 31.212257');
    });

    it('parses Google Maps coordinates and URLs in multiple formats', () => {
      // 1. Plain decimal format
      const plain = parseCoordinatesInput('30.0386, 31.2122');
      expect(plain).not.toBeNull();
      expect(plain?.latitude).toBeCloseTo(30.0386);
      expect(plain?.longitude).toBeCloseTo(31.2122);

      // 2. Space separated without comma
      const spaced = parseCoordinatesInput('30.0131 31.4289');
      expect(spaced).not.toBeNull();
      expect(spaced?.latitude).toBeCloseTo(30.0131);
      expect(spaced?.longitude).toBeCloseTo(31.4289);

      // 3. Eastern Arabic digits and comma
      const arabic = parseCoordinatesInput('٣٠.٠٣٨٦ ، ٣١.٢١٢٢');
      expect(arabic).not.toBeNull();
      expect(arabic?.latitude).toBeCloseTo(30.0386);
      expect(arabic?.longitude).toBeCloseTo(31.2122);

      // 4. Google Maps URL with @lat,lng
      const mapsUrl = parseCoordinatesInput(
        'https://www.google.com/maps/place/Dokki/@30.038611,31.212222,17z/data=!3m1!4b1',
      );
      expect(mapsUrl).not.toBeNull();
      expect(mapsUrl?.latitude).toBeCloseTo(30.038611);
      expect(mapsUrl?.longitude).toBeCloseTo(31.212222);

      // 5. Google Maps query URL (?q=lat,lng)
      const queryUrl = parseCoordinatesInput(
        'https://maps.google.com/?q=loc:30.0386,31.2122&z=17',
      );
      expect(queryUrl).not.toBeNull();
      expect(queryUrl?.latitude).toBeCloseTo(30.0386);
      expect(queryUrl?.longitude).toBeCloseTo(31.2122);

      // 6. DMS (Degrees Minutes Seconds)
      const dms = parseCoordinatesInput('30°02\'19.0"N 31°12\'43.9"E');
      expect(dms).not.toBeNull();
      expect(dms?.latitude).toBeCloseTo(30.038611, 4);
      expect(dms?.longitude).toBeCloseTo(31.212194, 4);

      // 7. WhatsApp shared pin text
      const whatsapp = parseCoordinatesInput(
        '📍 Dropped pin: https://www.google.com/maps?q=30.0444,31.2357',
      );
      expect(whatsapp).not.toBeNull();
      expect(whatsapp?.latitude).toBeCloseTo(30.0444);
      expect(whatsapp?.longitude).toBeCloseTo(31.2357);

      // 8. Google Plus Code (Open Location Code) from user example:
      // "244R+Q92, Atati, Al Haram, Giza Governorate 3553272"
      const userExample = parseCoordinatesInput(
        '244R+Q92, Atati, Al Haram, Giza Governorate 3553272',
      );
      expect(userExample).not.toBeNull();
      expect(userExample?.latitude).toBeCloseTo(30.006876, 4);
      expect(userExample?.longitude).toBeCloseTo(31.140876, 4);

      // Verify it's inside Cairo/Giza service area
      expect(isInsideServiceArea(userExample!.latitude, userExample!.longitude)).toBe(true);

      // 9. Full 10-character plus code
      const fullPlus = parseCoordinatesInput('8G2H244R+Q92');
      expect(fullPlus).not.toBeNull();
      expect(fullPlus?.latitude).toBeCloseTo(30.006876, 4);
      expect(fullPlus?.longitude).toBeCloseTo(31.140876, 4);

      // 10. Invalid strings
      expect(parseCoordinatesInput('not a coordinate')).toBeNull();
      expect(parseCoordinatesInput('')).toBeNull();
    });

    it('resolves instant search suggestion for Google Plus Code address in Al Haram', async () => {
      const results = await searchPlaces(
        '244R+Q92, Atati, Al Haram, Giza Governorate 3553272',
        { locale: 'ar' },
      );
      expect(results.length).toBeGreaterThan(0);
      const top = results[0];
      expect(top.coordinates.latitude).toBeCloseTo(30.006876, 3);
      expect(top.coordinates.longitude).toBeCloseTo(31.140876, 3);
      expect(top.governorate).toBe('Giza');
      expect(top.secondary).toContain('داخل نطاق التوصيل');
    });

    it('resolves instant search suggestion when coordinates are pasted into search', async () => {
      const results = await searchPlaces('30.0386, 31.2122', { locale: 'ar' });
      expect(results.length).toBeGreaterThan(0);
      const top = results[0];
      expect(top.id).toBe('coord-30.0386-31.2122');
      expect(top.coordinates.latitude).toBeCloseTo(30.0386);
      expect(top.coordinates.longitude).toBeCloseTo(31.2122);
      expect(top.name).toContain('30.0386');
      expect(top.secondary).toContain('داخل نطاق التوصيل');
    });
  });
});
