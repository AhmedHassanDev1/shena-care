'use client';

import { useCallback, useEffect, useRef, useState, useId } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { MapboxMap } from '@/components/map';
import '@/components/map/mapbox.css';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import {
  SERVICE_AREA_BOUNDS,
  DEFAULT_MAP_CENTRES,
  CAIRO_GIZA_AREAS,
  SHINACARE_HUB_COORDINATES,
  isInsideServiceArea,
  isDefaultCentre,
  projectMercator,
  unprojectMercator,
} from '../lib/service-area';
import {
  searchPlaces,
  reverseGeocode,
  parseCoordinatesInput,
  type Coordinates,
  type SearchResultItem,
  type GeocodedAddressSuggestion,
} from '../lib/location-service';

export {
  SERVICE_AREA_BOUNDS,
  DEFAULT_MAP_CENTRES,
  CAIRO_GIZA_AREAS,
  SHINACARE_HUB_COORDINATES,
  isInsideServiceArea,
  isDefaultCentre,
  projectMercator,
  unprojectMercator,
};

export interface LocationPin {
  latitude: number;
  longitude: number;
  locationSource: 'map_pin' | 'current_location';
  confirmed: boolean;
}

export interface DeliveryLocationPickerProps {
  value: LocationPin | null;
  onChange: (pin: LocationPin | null) => void;
  /** Callback fired whenever reverse geocoding suggests address components for the selected pin. */
  onAddressResolved?: (suggestion: GeocodedAddressSuggestion) => void;
  /** Error from the form or the server (no pin, improbable pin, out of bounds). */
  error?: string;
  /** Action on out-of-coverage state to select another saved address. */
  onChooseOther?: () => void;
  /** Where the map opens when there is no pin yet. */
  initialCenter?: { lat: number; lng: number };
  className?: string;
}

const FALLBACK_CENTRE = { lat: 30.0386, lng: 31.2122 }; // Dokki, Giza

function isSamePin(a: LocationPin | null, b: LocationPin | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.latitude - b.latitude) < 0.000001 &&
    Math.abs(a.longitude - b.longitude) < 0.000001 &&
    a.confirmed === b.confirmed &&
    a.locationSource === b.locationSource
  );
}

/**
 * Production-ready delivery location selection experience for ShinaCare:
 * Inspired by Airbnb's smooth map navigation with fixed center pin and
 * Amazon's verified delivery address management.
 *
 * Features:
 * - Automatic geolocation with proper permissions inspection
 * - Floating "حدد موقعي" button with loading, accuracy, and friendly error states
 * - Real address, neighborhood, and landmark autocomplete search with Arabic/English normalization
 * - Smooth map navigation with fixed center crosshair pin that springs up on pan and drops on idle
 * - Debounced, race-condition-safe reverse geocoding after user stops moving the map
 * - Responsive bottom sheet on mobile and spacious layout on desktop
 * - Clear, accessible "تأكيد الموقع" action with confirmed state review & edit
 * - Strict preservation of manual selections and previously selected addresses
 * - Resilient fallback to OpenStreetMap slippy tiles and curated local catalog
 */
export function DeliveryLocationPicker({
  value,
  onChange,
  onAddressResolved,
  error,
  onChooseOther,
  initialCenter,
  className,
}: DeliveryLocationPickerProps) {
  const m = useMessages();
  const locale = useLocale();
  const searchInputId = useId();

  // Authoritative coordinate state
  const [center, setCenter] = useState(() =>
    value ? { lat: value.latitude, lng: value.longitude } : initialCenter ?? FALLBACK_CENTRE,
  );
  const [zoom, setZoom] = useState(value ? 16 : 14);
  const [pin, setPin] = useState<LocationPin | null>(value);
  const [editing, setEditing] = useState(!value?.confirmed);

  // Map & interaction states
  const [isMapMoving, setIsMapMoving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [accuracyNotice, setAccuracyNotice] = useState<string | null>(null);
  const [detectedAccuracy, setDetectedAccuracy] = useState<number | null>(null);
  const [mapboxFailed, setMapboxFailed] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);

  // Geocoding suggestion state
  const [resolvedAddress, setResolvedAddress] = useState<GeocodedAddressSuggestion | null>(null);
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);

  // Copy coordinates feedback state
  const [copiedCoordinates, setCopiedCoordinates] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  // Coordinate import notice
  const [coordinatesNotice, setCoordinatesNotice] = useState<string | null>(null);
  const noticeTimeoutRef = useRef<number | null>(null);

  const searchAbortRef = useRef<AbortController | null>(null);
  const geocodeAbortRef = useRef<AbortController | null>(null);
  const geocodeSeqRef = useRef(0);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const hasAttemptedAutoLocate = useRef(false);

  const useMapbox = Boolean(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim()) && !mapboxFailed;

  // The picker's own emissions come back through `value` and must not reset user interactions
  const lastEmitted = useRef<LocationPin | null>(null);
  const emit = useCallback(
    (next: LocationPin | null) => {
      lastEmitted.current = next;
      onChange(next);
    },
    [onChange],
  );

  useEffect(() => {
    if (isSamePin(value, lastEmitted.current)) return;
    if (isSamePin(value, pin)) return;
    setPin(value);
    if (value) {
      setCenter({ lat: value.latitude, lng: value.longitude });
      setEditing(!value.confirmed);
    } else {
      setEditing(true);
      setResolvedAddress(null);
    }
  }, [value, pin]);

  // A new area to look at re-centres the map while no pin is set
  useEffect(() => {
    if (!pin && initialCenter) {
      setCenter(initialCenter);
    }
  }, [initialCenter?.lat, initialCenter?.lng]);

  // Reverse geocode whenever coordinates change (debounced, race-condition safe)
  const triggerReverseGeocode = useCallback(
    (lat: number, lng: number) => {
      geocodeAbortRef.current?.abort();
      const abort = new AbortController();
      geocodeAbortRef.current = abort;
      const seq = ++geocodeSeqRef.current;

      setIsResolvingAddress(true);

      const timer = window.setTimeout(async () => {
        try {
          const suggestion = await reverseGeocode({ latitude: lat, longitude: lng }, { locale, signal: abort.signal });
          if (seq === geocodeSeqRef.current) {
            setResolvedAddress(suggestion);
            setIsResolvingAddress(false);
            if (suggestion && onAddressResolved) {
              onAddressResolved(suggestion);
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') return;
          if (seq === geocodeSeqRef.current) {
            setIsResolvingAddress(false);
          }
        }
      }, 350);

      return () => {
        window.clearTimeout(timer);
        abort.abort();
      };
    },
    [locale, onAddressResolved],
  );

  // Initial geocode resolution if pin exists
  useEffect(() => {
    if (pin && !resolvedAddress) {
      triggerReverseGeocode(pin.latitude, pin.longitude);
    }
  }, [pin?.latitude, pin?.longitude]);

  // Place/update pin coordinates authoritatively
  const place = useCallback(
    (lat: number, lng: number, source: LocationPin['locationSource'] = 'map_pin') => {
      const roundedLat = Math.round(lat * 1_000_000) / 1_000_000;
      const roundedLng = Math.round(lng * 1_000_000) / 1_000_000;
      const next: LocationPin = {
        latitude: roundedLat,
        longitude: roundedLng,
        locationSource: source,
        confirmed: false,
      };
      setPin(next);
      setCenter({ lat: roundedLat, lng: roundedLng });
      setLocateError(null);
      emit(next);
      triggerReverseGeocode(roundedLat, roundedLng);
    },
    [emit, triggerReverseGeocode],
  );

  // Geolocation trigger using browser Geolocation API with accuracy tracking and error handling
  const locate = useCallback(
    (options?: { isAutomatic?: boolean }) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        if (!options?.isAutomatic) {
          setLocateError(m.checkoutMapLocateFailed);
        }
        return;
      }

      setLocating(true);
      setLocateError(null);
      setAccuracyNotice(null);

      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          setLocating(false);
          setEditing(true);

          const lat = coords.latitude;
          const lng = coords.longitude;
          const accuracy = coords.accuracy ? Math.round(coords.accuracy) : null;
          setDetectedAccuracy(accuracy);

          if (!isInsideServiceArea(lat, lng)) {
            setLocateError(m.checkoutMapOutOfService);
            return;
          }

          if (accuracy && accuracy > 80) {
            setAccuracyNotice(
              fillMessage(m.checkoutLocationGpsAccuracyWarning, {
                accuracy,
              }),
            );
          } else if (accuracy) {
            setAccuracyNotice(
              fillMessage(m.checkoutLocationAccurateNotice, {
                accuracy,
              }),
            );
          }

          setCenter({ lat, lng });
          setZoom(16);
          place(lat, lng, 'current_location');
        },
        (err) => {
          setLocating(false);
          if (err.code === err.PERMISSION_DENIED) {
            setLocateError(m.checkoutMapLocateDenied);
          } else if (!options?.isAutomatic) {
            setLocateError(m.checkoutMapLocateFailed);
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    },
    [m, place],
  );

  // Automatic user location detection on mount:
  // - Requests permission when needed
  // - Never overwrites a manually confirmed address
  // - Handles denials politely without trapping user
  useEffect(() => {
    // Never overwrite an already confirmed address
    if (value?.confirmed) return;
    if (hasAttemptedAutoLocate.current) return;
    hasAttemptedAutoLocate.current = true;

    if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (status.state === 'denied') {
            setLocateError(m.checkoutMapLocateDenied);
            return;
          }
          // For 'granted' or 'prompt', initiate geolocation detection
          locate({ isAutomatic: true });
        })
        .catch(() => {
          locate({ isAutomatic: true });
        });
    } else {
      locate({ isAutomatic: true });
    }
  }, [value?.confirmed, locate, m.checkoutMapLocateDenied]);

  // Search input change & debounced search
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchDropdownOpen(false);
      return;
    }

    searchAbortRef.current?.abort();
    const abort = new AbortController();
    searchAbortRef.current = abort;
    setIsSearching(true);

    const timer = window.setTimeout(async () => {
      try {
        const results = await searchPlaces(q, { locale, signal: abort.signal });
        setSearchResults(results);
        setIsSearching(false);
        setSearchDropdownOpen(true);
        setActiveSuggestionIndex(-1);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setIsSearching(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [searchQuery, locale]);

  // Close search dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectSearchResult = (result: SearchResultItem) => {
    setSearchQuery(result.name);
    setSearchDropdownOpen(false);
    setCenter({ lat: result.coordinates.latitude, lng: result.coordinates.longitude });
    setZoom(16);
    place(result.coordinates.latitude, result.coordinates.longitude, 'map_pin');
  };

  // Quick jump to popular neighborhoods
  const handleQuickArea = (area: (typeof CAIRO_GIZA_AREAS)[number]) => {
    setCenter({ lat: area.lat, lng: area.lng });
    setZoom(15);
    place(area.lat, area.lng, 'map_pin');
  };

  // Real coordinates from placed/detected pin (never default fallback center)
  const inArea = pin ? isInsideServiceArea(pin.latitude, pin.longitude) : false;
  const improbable = pin ? isDefaultCentre(pin.latitude, pin.longitude) : false;

  const confirm = () => {
    if (!pin || !inArea || improbable) return;
    const confirmed: LocationPin = { ...pin, confirmed: true };
    setPin(confirmed);
    setEditing(false);
    emit(confirmed);
  };

  const handleCopyCoordinates = useCallback(async () => {
    if (!pin) return;
    const text = `${pin.latitude.toFixed(6)}, ${pin.longitude.toFixed(6)}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedCoordinates(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedCoordinates(false);
      }, 2200);
    } catch {
      // Graceful fallback if permission or clipboard is blocked
    }
  }, [pin]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, []);

  const applyCoordinates = useCallback(
    (coords: Coordinates, displayName?: string) => {
      const qText = displayName || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
      setSearchQuery(qText);
      setSearchResults([]);
      setSearchDropdownOpen(false);
      setCenter({ lat: coords.latitude, lng: coords.longitude });
      setZoom(16);
      place(coords.latitude, coords.longitude, 'map_pin');
      setCoordinatesNotice(m.checkoutCoordinatesAppliedNotice);
      if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = window.setTimeout(() => setCoordinatesNotice(null), 3500);
    },
    [place, m.checkoutCoordinatesAppliedNotice],
  );

  const handleSearchPaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (!pasted || !pasted.trim()) return;

    // 1. Direct coordinate, Plus Code, or Google Maps URL
    const parsed = parseCoordinatesInput(pasted);
    if (parsed) {
      e.preventDefault();
      applyCoordinates(parsed, pasted.trim().slice(0, 45));
      return;
    }

    // 2. Textual address search and instant navigation
    const trimmed = pasted.trim();
    if (trimmed.length >= 3) {
      e.preventDefault();
      setSearchQuery(trimmed);
      try {
        const matches = await searchPlaces(trimmed, { locale });
        if (matches.length > 0) {
          applyCoordinates(matches[0].coordinates, matches[0].name);
        } else {
          setCoordinatesNotice(m.checkoutAddressNotFoundNotice);
          if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current);
          noticeTimeoutRef.current = window.setTimeout(() => setCoordinatesNotice(null), 3500);
        }
      } catch {
        // Fallback
      }
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        const trimmed = text.trim();
        if (!trimmed) {
          const inputEl = document.getElementById(searchInputId) as HTMLInputElement | null;
          inputEl?.focus();
          return;
        }

        // 1. Coordinates or Plus Code (e.g. "244R+Q92, Atati, Al Haram, Giza Governorate 3553272")
        const parsed = parseCoordinatesInput(trimmed);
        if (parsed) {
          applyCoordinates(parsed, trimmed.slice(0, 45));
          return;
        }

        // 2. Text address: search and apply top match immediately
        setSearchQuery(trimmed);
        try {
          const matches = await searchPlaces(trimmed, { locale });
          if (matches.length > 0) {
            applyCoordinates(matches[0].coordinates, matches[0].name);
            return;
          }
        } catch {
          // continue
        }

        setCoordinatesNotice(m.checkoutAddressNotFoundNotice);
        if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current);
        noticeTimeoutRef.current = window.setTimeout(() => setCoordinatesNotice(null), 3500);
        return;
      }
      const inputEl = document.getElementById(searchInputId) as HTMLInputElement | null;
      inputEl?.focus();
    } catch {
      const inputEl = document.getElementById(searchInputId) as HTMLInputElement | null;
      inputEl?.focus();
      setCoordinatesNotice(m.checkoutPasteCoordinatesHint);
      if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = window.setTimeout(() => setCoordinatesNotice(null), 3500);
    }
  };

  const showConfirmed = pin?.confirmed && !editing;

  return (
    <div className={cn('flex flex-col gap-3.5', className)}>
      {/* Search Bar with Autocomplete Suggestions */}
      {!showConfirmed ? (
        <div ref={searchContainerRef} className="relative z-20 flex flex-col gap-2">
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute start-3.5 flex items-center text-stone">
              <Icon name="search" size={18} />
            </span>
            <input
              id={searchInputId}
              type="text"
              role="combobox"
              aria-expanded={searchDropdownOpen}
              aria-controls="location-search-listbox"
              aria-autocomplete="list"
              aria-label={m.checkoutLocationSearchPlaceholder}
              placeholder={m.checkoutLocationSearchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onPaste={handleSearchPaste}
              onFocus={() => {
                if (searchResults.length > 0) setSearchDropdownOpen(true);
              }}
              onKeyDown={(e) => {
                if (!searchDropdownOpen || searchResults.length === 0) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveSuggestionIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveSuggestionIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1));
                } else if (e.key === 'Enter' && activeSuggestionIndex >= 0) {
                  e.preventDefault();
                  handleSelectSearchResult(searchResults[activeSuggestionIndex]);
                } else if (e.key === 'Escape') {
                  setSearchDropdownOpen(false);
                }
              }}
              className="h-11 w-full rounded-pill border border-line bg-linen pe-10 ps-10 font-display text-14 text-ink shadow-outline-control placeholder:text-stone focus:border-cobalt focus:outline-none focus:ring-1 focus:ring-cobalt"
            />
            {isSearching ? (
              <span className="pointer-events-none absolute end-3.5 flex items-center text-stone animate-spin">
                <Icon name="retry" size={16} />
              </span>
            ) : searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSearchResults([]);
                  setSearchDropdownOpen(false);
                }}
                aria-label={m.checkoutLocationClearSearch}
                className="absolute end-3 flex size-6 items-center justify-center rounded-full text-stone hover:bg-sand/60 hover:text-ink"
              >
                <Icon name="close" size={14} />
              </button>
            ) : null}
          </div>

          {/* Autocomplete Dropdown List */}
          {searchDropdownOpen ? (
            <div
              id="location-search-listbox"
              role="listbox"
              className="absolute top-full z-30 mt-1 max-h-60 w-full overflow-auto rounded-16 border border-line bg-linen py-1.5 shadow-elevation-2"
            >
              {searchResults.length > 0 ? (
                searchResults.map((item, index) => {
                  const isSelected = index === activeSuggestionIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelectSearchResult(item)}
                      onMouseEnter={() => setActiveSuggestionIndex(index)}
                      className={cn(
                        'flex w-full items-start gap-3 px-3.5 py-2.5 text-start transition-colors',
                        isSelected ? 'bg-sand/60 text-ink' : 'text-ink hover:bg-sand/40',
                      )}
                    >
                      <span className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-full bg-sand text-cobalt">
                        <Icon name={item.id.startsWith('coord-') ? 'gps' : item.category === 'landmark' ? 'shop' : 'pin'} size={14} />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-14 font-semibold text-ink">{item.name}</span>
                        <span className="truncate text-12 text-stone">{item.secondary}</span>
                      </div>
                    </button>
                  );
                })
              ) : !isSearching ? (
                <div className="px-4 py-3 text-center text-13 text-stone">
                  {m.checkoutLocationNoResults}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Quick Actions: Paste Google Maps Coordinates + Popular Neighborhoods Chips */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={handlePasteFromClipboard}
              title={m.checkoutPasteCoordinatesHint}
              className="inline-flex items-center gap-1.5 rounded-pill border border-cobalt/30 bg-sand/60 px-3 py-1 font-display text-12 font-semibold text-cobalt transition-all hover:bg-sand hover:text-cobalt-deep active:scale-95"
            >
              <Icon name="copy" size={13} className="text-cobalt" />
              <span>{m.checkoutPasteFromGoogleMaps}</span>
            </button>
            <span className="text-11 font-medium text-stone">{m.checkoutLocationQuickAreas}:</span>
            {CAIRO_GIZA_AREAS.slice(0, 5).map((area) => (
              <button
                key={area.nameEn}
                type="button"
                onClick={() => handleQuickArea(area)}
                className="rounded-pill bg-linen px-2.5 py-1 text-12 font-medium text-ink shadow-outline-hairline hover:bg-sand/50 hover:text-cobalt"
              >
                {locale.startsWith('ar') ? area.nameAr : area.nameEn}
              </button>
            ))}
          </div>

          {/* Coordinate import feedback alert */}
          {coordinatesNotice ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 rounded-16 bg-sand/80 px-3 py-2 text-12 font-medium text-ink shadow-elevation-1"
            >
              <Icon name="check" size={14} className="text-ok" />
              <span>{coordinatesNotice}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Interactive Map Viewport with Fixed Center Crosshair Pin */}
      <div className={cn('relative overflow-hidden rounded-24 border border-line shadow-outline-hairline', useMapbox ? 'h-72 sm:h-80 md:h-96' : 'h-auto')}>
        {useMapbox ? (
          <MapboxMap
            key={showConfirmed ? 'view' : 'edit'}
            center={center}
            zoom={zoom}
            pin={pin ? { latitude: pin.latitude, longitude: pin.longitude } : null}
            onPinChange={(coords) => place(coords.latitude, coords.longitude, 'map_pin')}
            onMovementChange={setIsMapMoving}
            mode="center_pin"
            interactive={!showConfirmed}
            draggable={!showConfirmed}
            showHub={false}
            onError={() => setMapboxFailed(true)}
            ariaLabel={m.checkoutPinTitle}
            className="h-full w-full rounded-24 border-0"
          />
        ) : (
          <TileMap
            center={center}
            zoom={zoom}
            pin={pin}
            interactive={!showConfirmed}
            onCenter={setCenter}
            onZoom={setZoom}
            onPlace={place}
            onMovementChange={setIsMapMoving}
            label={m.checkoutPinTitle}
          />
        )}

        {/* Floating Controls Over Map */}
        {!showConfirmed ? (
          <>
            {/* Floating "حدد موقعي" Button */}
            <button
              type="button"
              onClick={() => {
                void locate();
              }}
              aria-label={m.checkoutMapLocateMe}
              aria-busy={locating || undefined}
              disabled={locating}
              className="absolute start-3 top-3 z-10 inline-flex items-center gap-2 rounded-pill border border-line bg-linen/95 px-3.5 py-2 font-display text-13 font-semibold text-ink shadow-elevation-2 backdrop-blur-sm transition-all hover:bg-sand hover:scale-105 active:scale-95 disabled:opacity-60"
            >
              {locating ? (
                <span className="animate-spin text-cobalt">
                  <Icon name="retry" size={17} />
                </span>
              ) : (
                <Icon name="gps" size={17} className="text-cobalt" />
              )}
              <span>{locating ? m.checkoutLocatingPosition : m.checkoutMapLocateMe}</span>
            </button>

            {/* Service Area Coverage Indicator Badge (only shown once a real pin is placed) */}
            {pin ? (
              <div className="absolute end-3 top-3 z-10">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-12 font-semibold shadow-elevation-1 backdrop-blur-sm border',
                    inArea && !improbable
                      ? 'border-ok/30 bg-linen/95 text-ok'
                      : 'border-tomato/40 bg-linen/95 text-tomato-ink',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-2 rounded-full',
                      inArea && !improbable ? 'bg-ok animate-pulse' : 'bg-tomato-ink',
                    )}
                  />
                  <span>
                    {inArea && !improbable
                      ? m.checkoutLocationInService
                      : m.checkoutLocationOutOfServiceNotice}
                  </span>
                </span>
              </div>
            ) : null}

            {/* Instruction Banner at Map Bottom */}
            <div className="pointer-events-none absolute bottom-3 start-3 end-3 z-10 flex justify-center">
              <span className="rounded-pill bg-ink/80 px-4 py-1.5 text-12 font-medium text-linen shadow-elevation-2 backdrop-blur-sm">
                {isMapMoving ? m.checkoutLocationResolving : m.checkoutLocationMovePinHint}
              </span>
            </div>
          </>
        ) : null}
      </div>

      {/* Responsive Bottom Sheet on Mobile / Docked Panel on Desktop */}
      {!showConfirmed ? (
        <div className="flex flex-col gap-3.5 rounded-24 border border-line bg-linen p-4 sm:p-5 shadow-elevation-1">
          {/* Mobile Sheet Grab Handle */}
          <div aria-hidden="true" className="mx-auto -mt-1 h-1 w-10 rounded-pill bg-line-2 sm:hidden" />

          {/* Location details card */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-13 font-bold text-stone">
                <span className="grid size-6 place-items-center rounded-pill bg-sand text-cobalt">
                  <Icon name="pin" size={14} />
                </span>
                <span>{m.checkoutSelectedLocationTitle}</span>
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Accuracy in meters display for debugging & live accuracy feedback */}
                {detectedAccuracy !== null && pin?.locationSource === 'current_location' ? (
                  <span className="inline-flex items-center gap-1 rounded-pill bg-sand/70 px-2.5 py-0.5 text-11 font-medium text-stone">
                    <Icon name="gps" size={12} className="text-cobalt" />
                    <span>
                      {locale.startsWith('ar')
                        ? `دقة الـ GPS: ±${detectedAccuracy} متر`
                        : `GPS accuracy: ±${detectedAccuracy}m`}
                    </span>
                  </span>
                ) : pin?.locationSource === 'map_pin' ? (
                  <span className="inline-flex items-center gap-1 rounded-pill bg-sand/70 px-2.5 py-0.5 text-11 font-medium text-stone">
                    <Icon name="pin" size={12} className="text-cobalt" />
                    <span>
                      {locale.startsWith('ar') ? 'محدد يدويًا' : 'Manual pin'}
                    </span>
                  </span>
                ) : null}
                {pin ? (
                  <button
                    type="button"
                    onClick={handleCopyCoordinates}
                    title={copiedCoordinates ? m.checkoutCoordinatesCopied : m.checkoutCopyCoordinates}
                    aria-label={copiedCoordinates ? m.checkoutCoordinatesCopied : m.checkoutCopyCoordinates}
                    className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-linen/90 px-2.5 py-0.5 text-11 font-medium text-stone shadow-elevation-1 transition-all hover:border-cobalt/40 hover:bg-sand/60 hover:text-ink active:scale-95"
                  >
                    <Icon
                      name={copiedCoordinates ? 'check' : 'copy'}
                      size={12}
                      className={cn('transition-colors', copiedCoordinates ? 'text-ok' : 'text-stone')}
                    />
                    <span className="tabular-nums">
                      {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
                    </span>
                    <span className="text-11 font-medium text-stone">
                      {copiedCoordinates ? m.checkoutCoordinatesCopied : m.checkoutCopyCoordinates}
                    </span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="rounded-16 bg-chalk/80 p-3.5 shadow-outline-hairline">
              {isResolvingAddress ? (
                <div className="flex items-center gap-2 text-13.5 font-medium text-stone animate-pulse">
                  <span className="animate-spin text-cobalt">
                    <Icon name="retry" size={15} />
                  </span>
                  <span>{m.checkoutLocationResolving}</span>
                </div>
              ) : pin ? (
                <p className="m-0 text-15 font-bold leading-24 text-ink">
                  {resolvedAddress?.fullFormatted || `${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`}
                </p>
              ) : locating ? (
                <div className="flex items-center gap-2 text-13.5 font-medium text-stone animate-pulse">
                  <span className="animate-spin text-cobalt">
                    <Icon name="retry" size={15} />
                  </span>
                  <span>{m.checkoutLocatingPosition}</span>
                </div>
              ) : (
                <p className="m-0 text-14 text-stone">
                  {m.checkoutMapTapHint}
                </p>
              )}
            </div>
          </div>

          {/* Accuracy & Error Alerts */}
          {accuracyNotice ? (
            <p role="status" className="m-0 flex items-center gap-2 text-12 text-stone">
              <span aria-hidden="true" className="size-1.5 flex-none rounded-full bg-warn" />
              {accuracyNotice}
            </p>
          ) : null}

          {locateError ? (
            <p role="alert" className="m-0 flex items-center gap-2 text-13 font-medium text-tomato-ink">
              <span aria-hidden="true" className="size-1.5 flex-none rounded-full bg-tomato-ink" />
              {locateError}
            </p>
          ) : null}

          {improbable ? (
            <p role="alert" className="m-0 flex items-center gap-2 text-13 font-medium text-tomato-ink">
              <span aria-hidden="true" className="size-1.5 flex-none rounded-full bg-tomato-ink" />
              {m.checkoutMapImprobablePin}
            </p>
          ) : null}

          {pin && !inArea ? (
            <MessageBox tone="err" role="alert" className="rounded-16">
              <p className="m-0 text-13.5 font-semibold">{m.checkoutOutOfArea}</p>
              <p className="m-0 text-13 leading-20">{m.checkoutOutOfAreaBody}</p>
              {onChooseOther ? (
                <Button variant="ink" size="s" className="mt-2" onClick={onChooseOther}>
                  {m.checkoutChooseOtherAddress}
                </Button>
              ) : null}
            </MessageBox>
          ) : null}

          {/* Primary "تأكيد الموقع" CTA */}
          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <span className="hidden text-12 text-stone sm:inline">
              {m.checkoutLocationMovePinHint}
            </span>
            <Button
              variant="ink"
              size="m"
              onClick={confirm}
              disabled={!pin || !inArea || improbable || isMapMoving}
              className="w-full sm:w-auto min-w-[200px]"
            >
              <Icon name="check" size={18} strokeWidth={2.4} />
              <span>{m.checkoutConfirmLocation}</span>
            </Button>
          </div>
        </div>
      ) : null}

      {/* Confirmation State & Actions */}
      {showConfirmed ? (
        <div className="flex flex-wrap items-center justify-between gap-3.5 rounded-24 border border-ok/30 bg-linen p-4 sm:p-5 shadow-elevation-1">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="mt-0.5 grid size-9 flex-none place-items-center rounded-pill bg-ok text-white shadow-elevation-1">
              <Icon name="check" size={20} strokeWidth={2.8} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display text-15 font-bold text-ink">
                  {m.checkoutMapConfirmed}
                </span>
                <span className="inline-flex items-center gap-1 rounded-pill bg-ok-tint px-2.5 py-0.5 text-11 font-semibold text-ok">
                  <Icon name="pin" size={12} />
                  <span>{m.checkoutLocationInService}</span>
                </span>
                {pin ? (
                  <button
                    type="button"
                    onClick={handleCopyCoordinates}
                    title={copiedCoordinates ? m.checkoutCoordinatesCopied : m.checkoutCopyCoordinates}
                    aria-label={copiedCoordinates ? m.checkoutCoordinatesCopied : m.checkoutCopyCoordinates}
                    className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-sand/40 px-2.5 py-0.5 text-11 font-medium text-stone transition-all hover:border-cobalt/40 hover:bg-sand/70 hover:text-ink active:scale-95"
                  >
                    <Icon
                      name={copiedCoordinates ? 'check' : 'copy'}
                      size={12}
                      className={cn('transition-colors', copiedCoordinates ? 'text-ok' : 'text-stone')}
                    />
                    <span className="tabular-nums">
                      {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
                    </span>
                    <span className="text-11 font-medium text-stone">
                      {copiedCoordinates ? m.checkoutCoordinatesCopied : m.checkoutCopyCoordinates}
                    </span>
                  </button>
                ) : null}
              </div>
              <p className="m-0 text-14 leading-22 text-stone">
                {resolvedAddress?.fullFormatted || `${pin!.latitude.toFixed(5)}, ${pin!.longitude.toFixed(5)}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-sand/50 px-4 py-2 font-display text-13 font-semibold text-cobalt transition-colors hover:bg-sand hover:text-cobalt-deep"
          >
            <Icon name="swap" size={15} />
            <span>{m.checkoutEditLocation}</span>
          </button>
        </div>
      ) : null}

      {error && !showConfirmed ? (
        <p role="alert" tabIndex={-1} data-error-focus className="m-0 flex items-start gap-2 text-13.5 leading-22 text-tomato-ink">
          <span aria-hidden="true" className="mt-2 size-1.75 flex-none rounded-full bg-tomato-ink" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * OpenStreetMap slippy tiles fallback when Mapbox is unavailable or offline.
 * Upgraded to match the Airbnb fixed center pin workflow.
 */
function TileMap({
  center,
  zoom,
  pin,
  interactive,
  onCenter,
  onZoom,
  onPlace,
  onMovementChange,
  label,
}: {
  center: { lat: number; lng: number };
  zoom: number;
  pin: LocationPin | null;
  interactive: boolean;
  onCenter: (c: { lat: number; lng: number }) => void;
  onZoom: (z: number) => void;
  onPlace: (lat: number, lng: number) => void;
  onMovementChange?: (moving: boolean) => void;
  label: string;
}) {
  const m = useMessages();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 320 });
  const [isMoving, setIsMoving] = useState(false);
  const drag = useRef<{ x: number; y: number; px: { x: number; y: number } } | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const centerPx = projectMercator(center.lat, center.lng, zoom);
  const topLeft = { x: centerPx.x - size.width / 2, y: centerPx.y - size.height / 2 };
  const tiles: Array<{ key: string; x: number; y: number; left: number; top: number }> = [];
  const count = 2 ** zoom;

  for (let tx = Math.floor(topLeft.x / 256); tx <= Math.floor((topLeft.x + size.width) / 256); tx++) {
    for (let ty = Math.floor(topLeft.y / 256); ty <= Math.floor((topLeft.y + size.height) / 256); ty++) {
      if (ty < 0 || ty >= count) continue;
      const x = ((tx % count) + count) % count;
      tiles.push({ key: `${zoom}-${x}-${ty}`, x, y: ty, left: tx * 256 - topLeft.x, top: ty * 256 - topLeft.y });
    }
  }

  return (
    <div
      ref={ref}
      dir="ltr"
      role="region"
      aria-label={label}
      onPointerDown={(e) => {
        if (!interactive || e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, px: centerPx };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setIsMoving(true);
        onMovementChange?.(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const nextCenter = unprojectMercator(
          drag.current.px.x - (e.clientX - drag.current.x),
          drag.current.px.y - (e.clientY - drag.current.y),
          zoom,
        );
        onCenter(nextCenter);
      }}
      onPointerUp={(e) => {
        const start = drag.current;
        drag.current = null;
        setIsMoving(false);
        onMovementChange?.(false);
        if (!start || !ref.current) return;

        // If it was a click/tap without drag, center map on clicked point
        if (Math.abs(e.clientX - start.x) < 5 && Math.abs(e.clientY - start.y) < 5) {
          const rect = ref.current.getBoundingClientRect();
          const at = unprojectMercator(topLeft.x + e.clientX - rect.left, topLeft.y + e.clientY - rect.top, zoom);
          onCenter(at);
          onPlace(at.lat, at.lng);
        } else {
          // Commit center coordinates after drag
          onPlace(center.lat, center.lng);
        }
      }}
      className={cn(
        'relative h-72 sm:h-80 md:h-96 w-full select-none overflow-hidden rounded-24 bg-sand shadow-outline-hairline',
        interactive && 'cursor-grab active:cursor-grabbing',
      )}
    >
      {tiles.map((t) => (
        <img
          key={t.key}
          src={`https://tile.openstreetmap.org/${zoom}/${t.x}/${t.y}.png`}
          alt=""
          draggable={false}
          className="pointer-events-none absolute size-64 select-none opacity-90"
          style={{ transform: `translate3d(${t.left}px, ${t.top}px, 0)` }}
        />
      ))}

      {/* Stationary Center Pin for Airbnb-style interaction */}
      {interactive ? (
        <>
          <div aria-hidden="true" className="shinacare-center-target-ring" />
          <div aria-hidden="true" className={cn('shinacare-center-ground-shadow', isMoving && 'is-moving')} />
          <div
            aria-hidden="true"
            className={cn('shinacare-center-pin-container', isMoving && 'is-moving')}
          >
            <div className="shinacare-center-pin-head">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <div className="shinacare-center-pin-needle" />
          </div>
        </>
      ) : pin ? (
        // Locked confirmed marker for non-interactive view
        (() => {
          const pinPx = projectMercator(pin.latitude, pin.longitude, zoom);
          return (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -ms-4 -mt-9 flex flex-col items-center"
              style={{ transform: `translate3d(${pinPx.x - topLeft.x}px, ${pinPx.y - topLeft.y}px, 0)` }}
            >
              <span className="grid size-8 place-items-center rounded-pill bg-cobalt text-white shadow-elevation-2">
                <Icon name="pin" size={18} />
              </span>
              <span className="mt-0.5 size-1.5 rounded-pill bg-ink" />
            </span>
          );
        })()
      ) : null}

      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-0 start-0 z-10 bg-linen/90 px-1.5 text-11 text-stone"
      >
        © OpenStreetMap
      </a>

      {interactive ? (
        <span className="absolute bottom-2.5 end-2.5 z-10 flex flex-col overflow-hidden rounded-input border border-line bg-linen shadow-elevation-2">
          <button
            type="button"
            onClick={() => onZoom(Math.min(18, zoom + 1))}
            aria-label={m.checkoutMapZoomIn}
            className="grid size-9 place-items-center text-ink hover:bg-sand/40"
          >
            <Icon name="plus" size={16} />
          </button>
          <button
            type="button"
            onClick={() => onZoom(Math.max(10, zoom - 1))}
            aria-label={m.checkoutMapZoomOut}
            className="grid size-9 place-items-center text-ink hover:bg-sand/40"
          >
            <Icon name="minus" size={16} />
          </button>
        </span>
      ) : null}
    </div>
  );
}
