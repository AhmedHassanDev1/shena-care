'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusChip } from '@/components/ui/status-chip';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
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
import { MapboxMap } from '@/components/map';

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

interface DeliveryLocationPickerProps {
  value: LocationPin | null;
  onChange: (pin: LocationPin | null) => void;
  error?: string;
  className?: string;
}

export function DeliveryLocationPicker({
  value,
  onChange,
  error,
  className,
}: DeliveryLocationPickerProps) {
  const m = useMessages();
  const locale = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);

  // Map viewport center and zoom
  const [center, setCenter] = useState<{ lat: number; lng: number }>(() => ({
    lat: value?.latitude ?? 30.0386, // Initial Dokki / Cairo center
    lng: value?.longitude ?? 31.2122,
  }));
  const [zoom, setZoom] = useState(14);
  const [pin, setPin] = useState<LocationPin | null>(value);
  const [locating, setLocating] = useState(false);
  const [locatingError, setLocatingError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(!value?.confirmed);
  const [mapboxFailed, setMapboxFailed] = useState(false);

  const hasMapboxToken =
    typeof process !== 'undefined' &&
    Boolean(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN && process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN.trim());
  const useMapbox = hasMapboxToken && !mapboxFailed;


  // Dragging state
  const isDragging = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dragStartCenterPx = useRef({ x: 0, y: 0 });

  const [viewport, setViewport] = useState({ width: 640, height: 288 });
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setViewport({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [isEditing]);

  // Sync external value changes; the picker's own emissions come back through `value` and must not
  // re-centre the map under the customer's finger.
  const lastEmitted = useRef<LocationPin | null>(null);
  const emit = useCallback((next: LocationPin | null) => {
    lastEmitted.current = next;
    onChange(next);
  }, [onChange]);
  useEffect(() => {
    if (value && value !== lastEmitted.current) {
      setPin(value);
      setCenter({ lat: value.latitude, lng: value.longitude });
      if (value.confirmed) setIsEditing(false);
    }
  }, [value]);

  const placePinAt = useCallback(
    (lat: number, lng: number, source: 'map_pin' | 'current_location' = 'map_pin') => {
      const roundedLat = Math.round(lat * 1_000_000) / 1_000_000;
      const roundedLng = Math.round(lng * 1_000_000) / 1_000_000;
      const nextPin: LocationPin = {
        latitude: roundedLat,
        longitude: roundedLng,
        locationSource: source,
        confirmed: false,
      };
      setPin(nextPin);
      setLocatingError(null);
      // Immediately notify parent of the updated pin coordinate (unconfirmed until customer clicks confirm)
      emit(nextPin);
    },
    [emit],
  );

  const confirmPin = () => {
    if (!pin) return;
    if (!isInsideServiceArea(pin.latitude, pin.longitude)) {
      setLocatingError(m.checkoutMapOutOfService);
      return;
    }
    if (isDefaultCentre(pin.latitude, pin.longitude)) {
      setLocatingError(m.checkoutMapImprobablePin);
      return;
    }
    const confirmedPin: LocationPin = { ...pin, confirmed: true };
    setPin(confirmedPin);
    setIsEditing(false);
    setLocatingError(null);
    emit(confirmedPin);
  };

  const handleUseCurrentLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setLocatingError(m.checkoutMapLocateFailed);
      return;
    }
    setLocating(true);
    setLocatingError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        if (!isInsideServiceArea(latitude, longitude)) {
          setLocatingError(m.checkoutMapOutOfService);
          return;
        }
        setCenter({ lat: latitude, lng: longitude });
        setZoom(15);
        placePinAt(latitude, longitude, 'current_location');
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocatingError(
            locale === 'ar'
              ? 'تم رفض إذن تحديد الموقع. يمكنك اختيار موقعك يدوياً على الخريطة.'
              : 'Location permission was denied. You can select your location manually on the map.',
          );
        } else {
          setLocatingError(m.checkoutMapLocateFailed);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  // Drag pan handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only drag with primary mouse button or touch
    if (e.button !== 0) return;
    isDragging.current = true;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    const centerPx = projectMercator(center.lat, center.lng, zoom);
    dragStartCenterPx.current = centerPx;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStartPos.current.x;
    const dy = e.clientY - dragStartPos.current.y;
    const newPx = dragStartCenterPx.current.x - dx;
    const newPy = dragStartCenterPx.current.y - dy;
    const newCenter = unprojectMercator(newPx, newPy, zoom);
    setCenter(newCenter);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const dx = Math.abs(e.clientX - dragStartPos.current.x);
    const dy = Math.abs(e.clientY - dragStartPos.current.y);

    // If movement was less than 5px, treat as click to place pin
    if (dx < 5 && dy < 5 && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const centerPx = projectMercator(center.lat, center.lng, zoom);
      const topLeftPx = {
        x: centerPx.x - rect.width / 2,
        y: centerPx.y - rect.height / 2,
      };
      const clickedCoord = unprojectMercator(topLeftPx.x + clickX, topLeftPx.y + clickY, zoom);
      placePinAt(clickedCoord.lat, clickedCoord.lng, 'map_pin');
    }
  };

  // Compute tile layout from the canvas's real size so tiles, pin and clicks share one frame.
  const { width, height } = viewport;
  const centerPx = projectMercator(center.lat, center.lng, zoom);
  const topLeftPx = { x: centerPx.x - width / 2, y: centerPx.y - height / 2 };

  const minTileX = Math.floor(topLeftPx.x / 256);
  const maxTileX = Math.floor((topLeftPx.x + width) / 256);
  const minTileY = Math.floor(topLeftPx.y / 256);
  const maxTileY = Math.floor((topLeftPx.y + height) / 256);

  const tiles: Array<{ key: string; x: number; y: number; left: number; top: number }> = [];
  const maxTiles = Math.pow(2, zoom);
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      if (ty >= 0 && ty < maxTiles) {
        const wrappedTx = ((tx % maxTiles) + maxTiles) % maxTiles;
        tiles.push({
          key: `${zoom}-${wrappedTx}-${ty}`,
          x: wrappedTx,
          y: ty,
          left: tx * 256 - topLeftPx.x,
          top: ty * 256 - topLeftPx.y,
        });
      }
    }
  }

  // Position of pin inside viewport
  let pinPos: { left: number; top: number } | null = null;
  if (pin) {
    const pinPx = projectMercator(pin.latitude, pin.longitude, zoom);
    pinPos = {
      left: pinPx.x - topLeftPx.x,
      top: pinPx.y - topLeftPx.y,
    };
  }

  const inArea = pin ? isInsideServiceArea(pin.latitude, pin.longitude) : true;
  const isDefault = pin ? isDefaultCentre(pin.latitude, pin.longitude) : false;

  return (
    <section
      aria-labelledby="delivery-pin-title"
      className={cn('space-y-3 rounded-card border border-line bg-linen p-4', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="delivery-pin-title" className="text-title text-night">
            {m.checkoutMapTitle}
          </h2>
          <p className="text-14 text-ink-2">{m.checkoutMapHint}</p>
        </div>
        {pin?.confirmed && !isEditing ? (
          <StatusChip tone="ok" className="gap-1">
            <Icon name="check" size={14} />
            {m.checkoutMapConfirmed}
          </StatusChip>
        ) : null}
      </div>

      {/* Confirmed Summary Card (when collapsed/confirmed) */}
      {pin?.confirmed && !isEditing ? (
        <div className="space-y-3 rounded-card border border-line bg-sand p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-14 font-medium text-night">
                <Icon name="pin" size={18} className="text-blue" />
                <span>{m.orderConfirmedLocation}</span>
              </p>
              <p className="text-12 text-ink-3">
                <bdi>
                  {pin.latitude.toFixed(4)}, {pin.longitude.toFixed(4)}
                </bdi>
                {pin.locationSource === 'current_location' ? (
                  <span className="ms-2">({m.checkoutMapUseCurrentLocation})</span>
                ) : null}
              </p>
            </div>
            <Button
              variant="light"
              size="s"
              onClick={() => setIsEditing(true)}
              aria-label={m.checkoutMapChangePin}
            >
              {m.checkoutMapChangePin}
            </Button>
          </div>
        </div>
      ) : (
        /* Interactive Map Canvas */
        <div className="space-y-3">
          {/* Controls bar: GPS button & Quick area chips */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="light"
              size="s"
              loading={locating}
              onClick={handleUseCurrentLocation}
              className="gap-1.5"
            >
              <Icon name="pin" size={16} />
              {locating ? m.checkoutMapLocating : m.checkoutMapUseCurrentLocation}
            </Button>

            <span className="text-12 text-ink-3">{m.checkoutMapQuickAreas}:</span>
            <div className="flex flex-wrap gap-1.5">
              {CAIRO_GIZA_AREAS.slice(0, 5).map((area) => (
                <button
                  key={area.nameEn}
                  type="button"
                  onClick={() => {
                    // Pans only: an area centroid is not the customer's door, so no pin is placed.
                    setCenter({ lat: area.lat, lng: area.lng });
                    setZoom(15);
                  }}
                  className="rounded-pill border border-line bg-linen px-2.5 py-1 text-12 text-ink-2 transition-colors hover:bg-sand hover:text-night"
                >
                  <bdi>{locale === 'ar' ? area.nameAr : area.nameEn}</bdi>
                </button>
              ))}
            </div>
          </div>

          {useMapbox ? (
            <MapboxMap
              center={center}
              zoom={zoom}
              pin={pin ? { latitude: pin.latitude, longitude: pin.longitude } : null}
              onPinChange={(coords) => placePinAt(coords.latitude, coords.longitude, 'map_pin')}
              hubLocation={SHINACARE_HUB_COORDINATES}
              showHub={true}
              onError={(err) => {
                console.warn('Mapbox GL initialization failed, switching to fallback tile map:', err.message);
                setMapboxFailed(true);
              }}
              ariaLabel={m.checkoutMapTitle}
            />
          ) : (
            /* Slippy Tile Container (Fallback) */
            <div
              ref={containerRef}
              // Tile and pin offsets are physical pixels from the top-left corner; keep the canvas LTR in Arabic.
              dir="ltr"
              tabIndex={0}
              role="region"
              aria-label={m.checkoutMapTitle}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="relative h-72 w-full cursor-grab select-none overflow-hidden rounded-card border border-line bg-sand active:cursor-grabbing focus:outline-none focus:ring-1 focus:ring-blue"
            >
              {/* Tile Images */}
              {tiles.map((t) => (
                <img
                  key={t.key}
                  src={`https://tile.openstreetmap.org/${zoom}/${t.x}/${t.y}.png`}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="pointer-events-none absolute h-64 w-64 select-none opacity-90 transition-opacity"
                  style={{
                    transform: `translate3d(${t.left}px, ${t.top}px, 0)`,
                    width: '256px',
                    height: '256px',
                  }}
                />
              ))}

              {/* Marker Pin */}
              {pinPos ? (
                <div
                  className="pointer-events-none absolute -ms-4 -mt-8 flex flex-col items-center transition-transform"
                  style={{
                    transform: `translate3d(${pinPos.left}px, ${pinPos.top}px, 0)`,
                  }}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-pill bg-blue text-white shadow-elevation-2">
                    <Icon name="pin" size={18} />
                  </div>
                  <div className="h-1.5 w-1.5 rounded-pill bg-night" />
                </div>
              ) : null}

              {/* Viewport Map Center Crosshair (subtle guide) */}
              {!pinPos ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-2 w-2 rounded-pill border border-blue bg-blue/20" />
                </div>
              ) : null}

              <p className="pointer-events-auto absolute bottom-0 start-0 bg-linen px-1.5 text-12 text-ink-2">
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                  © OpenStreetMap
                </a>
              </p>

              {/* Zoom Controls */}
              <div className="absolute bottom-3 end-3 flex flex-col gap-1.5 rounded-input border border-line bg-linen p-1 shadow-elevation-2">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(18, z + 1))}
                  aria-label={m.checkoutMapZoomIn}
                  className="flex h-8 w-8 items-center justify-center rounded-input text-night transition-colors hover:bg-sand"
                >
                  <Icon name="plus" size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(10, z - 1))}
                  aria-label={m.checkoutMapZoomOut}
                  className="flex h-8 w-8 items-center justify-center rounded-input text-night transition-colors hover:bg-sand"
                >
                  <Icon name="minus" size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Location Validation and Status Bar */}
          {locatingError ? (
            <p role="alert" className="flex items-center gap-1.5 text-14 text-err">
              <Icon name="alert" size={16} />
              {locatingError}
            </p>
          ) : null}

          {pin && !inArea ? (
            <p role="alert" className="flex items-center gap-1.5 text-14 text-err">
              <Icon name="alert" size={16} />
              {m.checkoutMapOutOfService}
            </p>
          ) : null}

          {pin && inArea && isDefault ? (
            <p role="alert" className="flex items-center gap-1.5 text-14 text-err">
              <Icon name="alert" size={16} />
              {m.checkoutMapImprobablePin}
            </p>
          ) : null}

          {/* Action Row: Selected Coordinates & Explicit Confirm Button */}
          {pin ? (
            <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-14 text-ink-2">
                <bdi>
                  {fillMessage(m.checkoutMapCoordinates, {
                    lat: pin.latitude.toFixed(4),
                    lng: pin.longitude.toFixed(4),
                  })}
                </bdi>
              </p>

              <Button
                type="button"
                size="s"
                onClick={confirmPin}
                disabled={!inArea || isDefault}
                className="gap-1.5"
              >
                <Icon name="check" size={16} />
                {m.checkoutMapConfirmPin}
              </Button>
            </div>
          ) : (
            <p className="text-14 text-ink-3">{m.checkoutMapHint}</p>
          )}
        </div>
      )}

      {/* Outer validation error if submitted without confirmed pin */}
      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-14 text-err">
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : null}
    </section>
  );
}
