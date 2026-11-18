'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './ambient-sky.css';

export type AmbientTheme = 'AM' | 'PM';

/**
 * Photographic shutter light, fixed behind the whole page (portalled to <body> so a translucent header and glass surfaces show it).
 * Always aria-hidden and pointer-events none: it carries no information. `morningOnly` mounts only the Morning layer, so a page that
 * never shows Evening (the chatbot) never downloads the Evening picture. The light enters from the START edge of the page: upper-left in
 * LTR, upper-right in RTL (the stylesheet mirrors the layer under html[dir='rtl']). `calm` swaps the Morning picture for a softened,
 * linen-toned variant that fades out before the content (routine pages); the chatbot keeps the original.
 */
export function AmbientSky({ morningOnly = false, calm = false }: { morningOnly?: boolean; calm?: boolean }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  if (!host) return null;
  return createPortal(
    <div aria-hidden="true" className={calm ? "routine-sky routine-sky--calm" : "routine-sky"}>
      <div className="routine-sky__layer routine-sky__am" />
      {morningOnly ? null : <div className="routine-sky__layer routine-sky__pm" />}
    </div>,
    host
  );
}

/**
 * Puts the ambient theme on <html> (the stylesheet remaps surface tokens from it and fades the matching layer in), and removes it
 * when the page closes, so nothing leaks into other storefront pages.
 */
export function useAmbientTheme(theme: AmbientTheme | null) {
  useEffect(() => {
    if (!theme) return;
    const root = document.documentElement;
    root.dataset.routineTheme = theme;
    return () => {
      delete root.dataset.routineTheme;
    };
  }, [theme]);
}

/** Morning-only ambient background for a whole page (Ask Shina). No Evening, no period switch. */
export function MorningAmbient() {
  useAmbientTheme('AM');
  return <AmbientSky morningOnly />;
}
