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
  zoom = 14,
  pin,
  onPinChange,
  draggable = true,
  interactive = true,
  hubLocation,
  showHub = true,
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

  // Stable callbacks
  const onPinChangeRef = useRef(onPinChange);
  onPinChangeRef.current = onPinChange;
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

    // Map click to place/move pin
    if (interactive) {
      map.on('click', (e) => {
        const roundedLat = Math.round(e.lngLat.lat * 1_000_000) / 1_000_000;
        const roundedLng = Math.round(e.lngLat.lng * 1_000_000) / 1_000_000;
        onPinChangeRef.current?.({ latitude: roundedLat, longitude: roundedLng });
      });
    }

    return () => {
      customerMarkerRef.current?.remove();
      hubMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update center and zoom when props change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;
    map.easeTo({ center: [center.lng, center.lat], zoom });
  }, [center.lat, center.lng, zoom, isLoaded]);

  // Manage customer delivery pin marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoaded) return;

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
        <div class="flex h-8 w-8 items-center justify-center rounded-pill bg-primary text-primary-foreground shadow-float">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
        </div>
        <div class="h-1.5 w-1.5 rounded-pill bg-foreground mt-0.5"></div>
      `;

      const marker = new mapboxgl.Marker({
        element: pinEl,
        draggable,
        anchor: 'bottom',
      })
        .setLngLat([pin.longitude, pin.latitude])
        .addTo(map);

      marker.on('dragstart', () => {
        pinEl.classList.add('is-dragging');
      });

      marker.on('dragend', () => {
        pinEl.classList.remove('is-dragging');
        const lngLat = marker.getLngLat();
        const roundedLat = Math.round(lngLat.lat * 1_000_000) / 1_000_000;
        const roundedLng = Math.round(lngLat.lng * 1_000_000) / 1_000_000;
        onPinChangeRef.current?.({ latitude: roundedLat, longitude: roundedLng });
      });

      customerMarkerRef.current = marker;
    } else {
      customerMarkerRef.current.setLngLat([pin.longitude, pin.latitude]);
      customerMarkerRef.current.setDraggable(draggable);
    }
  }, [pin, draggable, isLoaded]);

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
        <div class="flex items-center gap-1.5 rounded-pill border border-border bg-card px-2 py-0.5 text-caption font-medium text-foreground shadow-float">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-primary">
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
        'relative h-72 w-full select-none overflow-hidden rounded-md border border-border bg-sand focus:outline-none focus:ring-1 focus:ring-ring',
        className,
      )}
    />
  );
}
