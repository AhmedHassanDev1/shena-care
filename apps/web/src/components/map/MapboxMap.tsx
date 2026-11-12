'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { cn } from '@/lib/utils';
import './mapbox.css';

export interface MapCoordinates {
  latitude: number;
  longitude: number;
}

export interface HubLocation extends MapCoordinates {
  name?: string;
}

export interface MapboxMapProps {
  center: { lat: number; lng: number };
  zoom?: number;
  pin?: MapCoordinates | null;
  onPinChange?: (coords: MapCoordinates) => void;
  onMovementChange?: (isMoving: boolean) => void;
  mode?: 'center_pin' | 'marker';
  draggable?: boolean;
  interactive?: boolean;
  hubLocation?: HubLocation | null;
  showHub?: boolean;
  onLoad?: () => void;
  onError?: (err: Error) => void;
  className?: string;
  ariaLabel?: string;
}

export function MapboxMap({
  center,
  zoom = 15,
  pin,
  onPinChange,
  onMovementChange,
  mode = 'marker',
  draggable = true,
  interactive = true,
  hubLocation,
  showHub = false,
  onLoad,
  onError,
  className,
  ariaLabel,
}: MapboxMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const customerMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const hubMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isMoving, setIsMoving] = useState(false);

  // Stable callbacks
  const onPinChangeRef = useRef(onPinChange);
  onPinChangeRef.current = onPinChange;
  const onMovementChangeRef = useRef(onMovementChange);
  onMovementChangeRef.current = onMovementChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  // Initialize Mapbox map
  useEffect(() => {
    if (!containerRef.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!token || !token.trim()) {
      onErrorRef.current?.(new Error('MISSING_MAPBOX_TOKEN'));
      return;
    }

    if (!mapboxgl.supported()) {
      onErrorRef.current?.(new Error('WEBGL_UNSUPPORTED'));
      return;
    }

    mapboxgl.accessToken = token;

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [center.lng, center.lat],
        zoom,
        attributionControl: false,
        interactive,
      });
      mapRef.current = map;
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // Add navigation controls (zoom in / zoom out)
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', () => {
      setIsLoaded(true);
      map.resize();
      onLoadRef.current?.();
    });

    map.on('error', (e) => {
      if (e.error) {
        onErrorRef.current?.(e.error);
      }
    });

    if (interactive) {
      let isUserInteracting = false;

      if (mode === 'center_pin') {
        map.on('movestart', (e) => {
          isUserInteracting = Boolean(e.originalEvent);
          setIsMoving(true);
          onMovementChangeRef.current?.(true);
        });

        map.on('moveend', () => {
          setIsMoving(false);
          onMovementChangeRef.current?.(false);
          const wasUser = isUserInteracting;
          isUserInteracting = false;
          if (wasUser) {
            const c = map.getCenter();
            const roundedLat = Math.round(c.lat * 1_000_000) / 1_000_000;
            const roundedLng = Math.round(c.lng * 1_000_000) / 1_000_000;
            onPinChangeRef.current?.({ latitude: roundedLat, longitude: roundedLng });
          }
        });

        map.on('click', (e) => {
          const roundedLat = Math.round(e.lngLat.lat * 1_000_000) / 1_000_000;
          const roundedLng = Math.round(e.lngLat.lng * 1_000_000) / 1_000_000;
          onPinChangeRef.current?.({ latitude: roundedLat, longitude: roundedLng });
          map.easeTo({ center: [roundedLng, roundedLat], duration: 300 });
        });
      } else {
        // Direct marker mode: tapping anywhere places/moves the pin immediately
        map.on('click', (e) => {
          const roundedLat = Math.round(e.lngLat.lat * 1_000_000) / 1_000_000;
          const roundedLng = Math.round(e.lngLat.lng * 1_000_000) / 1_000_000;
          onPinChangeRef.current?.({ latitude: roundedLat, longitude: roundedLng });
          map.easeTo({ center: [roundedLng, roundedLat], duration: 300 });
        });
      }
    }

    return () => {
      customerMarkerRef.current?.remove();
      hubMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [interactive, mode]);

  // Responsive resize observation
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Update center when props change from outside (search selection, current location, initial load)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;

    const currentCenter = map.getCenter();
    const dLat = Math.abs(currentCenter.lat - center.lat);
    const dLng = Math.abs(currentCenter.lng - center.lng);

    // Only programmatic moves with meaningful displacement (> 20 meters) trigger flyTo
    if (dLat > 0.0002 || dLng > 0.0002 || Math.abs(map.getZoom() - zoom) > 0.5) {
      map.flyTo({
        center: [center.lng, center.lat],
        zoom,
        essential: true,
        duration: 800,
      });
    }
  }, [center.lat, center.lng, zoom, isLoaded]);

  // Manage customer delivery pin marker when in marker mode or non-interactive confirmed mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;

    // In center_pin interactive mode, the stationary center overlay replaces the marker
    if (mode === 'center_pin' && interactive) {
      customerMarkerRef.current?.remove();
      customerMarkerRef.current = null;
      return;
    }

    if (!pin) {
      customerMarkerRef.current?.remove();
      customerMarkerRef.current = null;
      return;
    }

    if (!customerMarkerRef.current) {
      const pinEl = document.createElement('div');
      pinEl.className = 'shinacare-customer-pin';
      pinEl.setAttribute('role', 'img');
      pinEl.setAttribute('aria-label', 'Delivery location pin');
      pinEl.innerHTML = `
        <div class="shinacare-customer-pin-bubble">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </div>
        <div class="shinacare-customer-pin-needle"></div>
        <div class="shinacare-customer-pin-point"></div>
      `;

      const marker = new mapboxgl.Marker({
        element: pinEl,
        draggable: draggable && interactive,
        anchor: 'bottom',
      })
        .setLngLat([pin.longitude, pin.latitude])
        .addTo(map);

      marker.on('dragstart', () => {
        pinEl.classList.add('is-dragging');
        onMovementChangeRef.current?.(true);
      });

      marker.on('dragend', () => {
        pinEl.classList.remove('is-dragging');
        onMovementChangeRef.current?.(false);
        const lngLat = marker.getLngLat();
        const roundedLat = Math.round(lngLat.lat * 1_000_000) / 1_000_000;
        const roundedLng = Math.round(lngLat.lng * 1_000_000) / 1_000_000;
        onPinChangeRef.current?.({ latitude: roundedLat, longitude: roundedLng });
      });

      customerMarkerRef.current = marker;
    } else {
      const cur = customerMarkerRef.current.getLngLat();
      if (Math.abs(cur.lat - pin.latitude) > 0.000001 || Math.abs(cur.lng - pin.longitude) > 0.000001) {
        customerMarkerRef.current.setLngLat([pin.longitude, pin.latitude]);
      }
      customerMarkerRef.current.setDraggable(draggable && interactive);
    }
  }, [pin?.latitude, pin?.longitude, draggable, interactive, mode, isLoaded]);

  // Manage fulfillment hub marker (route origin)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;

    if (!hubLocation || !showHub) {
      hubMarkerRef.current?.remove();
      hubMarkerRef.current = null;
      return;
    }

    if (!hubMarkerRef.current) {
      const hubEl = document.createElement('div');
      hubEl.className = 'shinacare-hub-marker';
      hubEl.setAttribute('role', 'img');
      hubEl.setAttribute('aria-label', hubLocation.name ?? 'ShinaCare Hub');
      hubEl.innerHTML = `
        <div class="flex items-center gap-1.5 rounded-pill border border-line bg-linen px-2 py-0.5 text-12 font-medium text-ink shadow-elevation-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-cobalt">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span>${hubLocation.name ?? 'ShinaCare Hub'}</span>
        </div>
      `;

      const popup = new mapboxgl.Popup({
        offset: 16,
        closeButton: false,
        className: 'shinacare-map-popup',
      }).setText(hubLocation.name ?? 'ShinaCare Hub (Route Origin)');

      const marker = new mapboxgl.Marker({
        element: hubEl,
        anchor: 'center',
      })
        .setLngLat([hubLocation.longitude, hubLocation.latitude])
        .setPopup(popup)
        .addTo(map);

      hubMarkerRef.current = marker;
    } else {
      hubMarkerRef.current.setLngLat([hubLocation.longitude, hubLocation.latitude]);
    }
  }, [hubLocation, showHub, isLoaded]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={ariaLabel ?? 'Interactive Map'}
      dir="ltr"
      className={cn(
        'relative h-72 w-full select-none overflow-hidden rounded-card border border-line bg-sand focus:outline-none focus:ring-1 focus:ring-cobalt',
        className,
      )}
    >
      {/* Stationary center pin overlay for center_pin mode */}
      {interactive && mode === 'center_pin' ? (
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
      ) : null}
    </div>
  );
}
