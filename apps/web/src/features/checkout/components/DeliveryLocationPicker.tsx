'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { MapboxMap } from '@/components/map';
import { useMessages } from '@/lib/i18n/LocaleProvider';
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
  /** Error from the form or the server (no pin, improbable pin). */
  error?: string;
  /** «اختار عنوان تاني» on the outside-coverage state (CommerceStates §٣); omitted where there is no other address. */
  onChooseOther?: () => void;
  /** Where the map opens when there is no pin yet (e.g. the chosen area). */
  initialCenter?: { lat: number; lng: number };
  className?: string;
}

const FALLBACK_CENTRE = { lat: 30.0386, lng: 31.2122 };

/**
 * «مكان الدبوس» (CheckoutD, CommerceMobile ٣, CommerceStates §٣). The customer places the pin and confirms it; the
 * server refuses unconfirmed, default-centre and out-of-coverage pins. States:
 *  - confirmed: the map with the pin, «الدبوس متأكد على العنوان» and «عدّل مكان الدبوس»;
 *  - placing: tap the map (or «استخدم موقعي»), then «أكّد مكان الدبوس»;
 *  - no pin: inline error with «استخدم موقعي»;
 *  - outside Cairo/Giza: «لسه ما بنوصلش للمكان ده.» with «اختار عنوان تاني».
 * Mapbox when a token is configured, otherwise OpenStreetMap tiles.
 */
export function DeliveryLocationPicker({ value, onChange, error, onChooseOther, initialCenter, className }: DeliveryLocationPickerProps) {
  const m = useMessages();
  const [center, setCenter] = useState(() =>
    value ? { lat: value.latitude, lng: value.longitude } : initialCenter ?? FALLBACK_CENTRE
  );
  const [zoom, setZoom] = useState(value ? 16 : 14);
  const [pin, setPin] = useState<LocationPin | null>(value);
  const [editing, setEditing] = useState(!value?.confirmed);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [mapboxFailed, setMapboxFailed] = useState(false);
  const useMapbox = Boolean(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim()) && !mapboxFailed;

  // The picker's own emissions come back through `value` and must not re-centre the map under the finger.
  const lastEmitted = useRef<LocationPin | null>(null);
  const emit = useCallback(
    (next: LocationPin | null) => {
      lastEmitted.current = next;
      onChange(next);
    },
    [onChange]
  );
  useEffect(() => {
    if (value === lastEmitted.current) return;
    setPin(value);
    if (value) {
      setCenter({ lat: value.latitude, lng: value.longitude });
      setEditing(!value.confirmed);
    } else {
      setEditing(true);
    }
  }, [value]);

  // A new area to look at (another address) re-centres the map while no pin is set.
  useEffect(() => {
    if (!pin && initialCenter) setCenter(initialCenter);
  }, [initialCenter?.lat, initialCenter?.lng]);

  const place = useCallback(
    (lat: number, lng: number, source: LocationPin['locationSource'] = 'map_pin') => {
      const next: LocationPin = {
        latitude: Math.round(lat * 1_000_000) / 1_000_000,
        longitude: Math.round(lng * 1_000_000) / 1_000_000,
        locationSource: source,
        confirmed: false,
      };
      setPin(next);
      setLocateError(null);
      emit(next);
    },
    [emit]
  );

  const inArea = pin ? isInsideServiceArea(pin.latitude, pin.longitude) : true;
  const improbable = pin ? isDefaultCentre(pin.latitude, pin.longitude) : false;

  const confirm = () => {
    if (!pin || !inArea || improbable) return;
    const confirmed = { ...pin, confirmed: true };
    setPin(confirmed);
    setEditing(false);
    emit(confirmed);
  };

  const locate = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocateError(m.checkoutMapLocateFailed);
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        setEditing(true);
        setCenter({ lat: coords.latitude, lng: coords.longitude });
        setZoom(16);
        place(coords.latitude, coords.longitude, 'current_location');
      },
      (err) => {
        setLocating(false);
        setLocateError(err.code === err.PERMISSION_DENIED ? m.checkoutMapLocateDenied : m.checkoutMapLocateFailed);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const showConfirmed = pin?.confirmed && !editing;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* mapbox-gl sets .mapboxgl-map { height: 100% }, so the wrapper carries the height. */}
      <div className={cn('relative', useMapbox && 'h-56')}>
        {useMapbox ? (
          <MapboxMap
            key={showConfirmed ? 'view' : 'edit'}
            center={center}
            zoom={zoom}
            pin={pin ? { latitude: pin.latitude, longitude: pin.longitude } : null}
            onPinChange={(coords) => place(coords.latitude, coords.longitude)}
            interactive={!showConfirmed}
            draggable={!showConfirmed}
            showHub={false}
            onError={() => setMapboxFailed(true)}
            ariaLabel={m.checkoutPinTitle}
            className="h-full rounded-input border-0 shadow-outline-hairline"
          />
        ) : (
          <TileMap center={center} zoom={zoom} pin={pin} interactive={!showConfirmed} onCenter={setCenter} onZoom={setZoom} onPlace={place} label={m.checkoutPinTitle} />
        )}
        {showConfirmed ? null : (
          <button
            type="button"
            onClick={locate}
            aria-label={m.checkoutMapUseCurrentLocation}
            aria-busy={locating || undefined}
            className="absolute start-2.5 top-2.5 grid size-11 place-items-center rounded-pill bg-linen text-night shadow-elevation-2 disabled:opacity-60"
            disabled={locating}
          >
            <Icon name="gps" size={20} />
          </button>
        )}
      </div>

      {showConfirmed ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-13.5 font-semibold text-ok">
            <Icon name="check" size={16} strokeWidth={2.4} />
            {m.checkoutPinConfirmed}
          </span>
          <button type="button" onClick={() => setEditing(true)} className="text-link text-13.5">
            {m.checkoutPinEdit}
          </button>
        </div>
      ) : pin && !inArea ? (
        <MessageBox tone="err" role="alert">
          <p className="m-0 text-14 font-semibold leading-22">{m.checkoutOutOfArea}</p>
          <p className="m-0 text-14 leading-22">{m.checkoutOutOfAreaBody}</p>
          {onChooseOther ? (
            <Button variant="ink" size="s" className="mt-2" onClick={onChooseOther}>
              {m.checkoutChooseOtherAddress}
            </Button>
          ) : null}
        </MessageBox>
      ) : pin ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {improbable ? (
            <p role="alert" className="m-0 flex items-center gap-2 text-13.5 text-err">
              <span aria-hidden="true" className="size-1.75 flex-none rounded-full bg-err" />
              {m.checkoutMapImprobablePin}
            </p>
          ) : (
            <p className="m-0 text-13 leading-20 text-ink-2">{m.checkoutMapTapHint}</p>
          )}
          <Button variant="ink" size="s" onClick={confirm} disabled={improbable}>
            <Icon name="check" size={16} strokeWidth={2.4} />
            {m.checkoutMapConfirmPin}
          </Button>
        </div>
      ) : (
        <p className="m-0 text-13 leading-20 text-ink-2">{m.checkoutMapTapHint}</p>
      )}

      {locateError ? (
        <p role="alert" className="m-0 flex items-center gap-2 text-13.5 text-err">
          <span aria-hidden="true" className="size-1.75 flex-none rounded-full bg-err" />
          {locateError}
        </p>
      ) : null}

      {error && !showConfirmed ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="alert" tabIndex={-1} data-error-focus className="m-0 flex items-start gap-2 text-13.5 leading-22 text-err">
            <span aria-hidden="true" className="mt-2 size-1.75 flex-none rounded-full bg-err" />
            {error}
          </p>
          {pin ? null : (
            <Button variant="light" size="s" onClick={locate} loading={locating}>
              <Icon name="gps" size={16} />
              {m.checkoutMapUseCurrentLocation}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** OpenStreetMap tiles when Mapbox is not configured or fails: drag to pan, tap to place. */
function TileMap({
  center,
  zoom,
  pin,
  interactive,
  onCenter,
  onZoom,
  onPlace,
  label,
}: {
  center: { lat: number; lng: number };
  zoom: number;
  pin: LocationPin | null;
  interactive: boolean;
  onCenter: (c: { lat: number; lng: number }) => void;
  onZoom: (z: number) => void;
  onPlace: (lat: number, lng: number) => void;
  label: string;
}) {
  const m = useMessages();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 220 });
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
  const pinPx = pin ? projectMercator(pin.latitude, pin.longitude, zoom) : null;

  return (
    <div
      ref={ref}
      // Tile and pin offsets are physical pixels from the top-left corner: the canvas stays LTR in Arabic.
      dir="ltr"
      role="region"
      aria-label={label}
      onPointerDown={(e) => {
        if (!interactive || e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, px: centerPx };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        onCenter(unprojectMercator(drag.current.px.x - (e.clientX - drag.current.x), drag.current.px.y - (e.clientY - drag.current.y), zoom));
      }}
      onPointerUp={(e) => {
        const start = drag.current;
        drag.current = null;
        if (!start || Math.abs(e.clientX - start.x) > 5 || Math.abs(e.clientY - start.y) > 5 || !ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const at = unprojectMercator(topLeft.x + e.clientX - rect.left, topLeft.y + e.clientY - rect.top, zoom);
        onPlace(at.lat, at.lng);
      }}
      className={cn(
        'relative h-56 w-full select-none overflow-hidden rounded-input bg-sand shadow-outline-hairline',
        interactive && 'cursor-grab active:cursor-grabbing'
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
      {pinPx ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -ms-4 -mt-9 flex flex-col items-center"
          style={{ transform: `translate3d(${pinPx.x - topLeft.x}px, ${pinPx.y - topLeft.y}px, 0)` }}
        >
          <span className="grid size-8 place-items-center rounded-pill bg-bottle text-white shadow-elevation-2">
            <Icon name="pin" size={18} />
          </span>
          <span className="mt-0.5 size-1.5 rounded-pill bg-night" />
        </span>
      ) : null}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-0 start-0 bg-linen/90 px-1.5 text-11 text-ink-2"
      >
        © OpenStreetMap
      </a>
      {interactive ? (
        <span className="absolute bottom-2.5 end-2.5 flex flex-col overflow-hidden rounded-input bg-linen shadow-elevation-2">
          <button type="button" onClick={() => onZoom(Math.min(18, zoom + 1))} aria-label={m.checkoutMapZoomIn} className="grid size-9 place-items-center text-night">
            <Icon name="plus" size={16} />
          </button>
          <button type="button" onClick={() => onZoom(Math.max(10, zoom - 1))} aria-label={m.checkoutMapZoomOut} className="grid size-9 place-items-center text-night">
            <Icon name="minus" size={16} />
          </button>
        </span>
      ) : null}
    </div>
  );
}
