'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Maximum tilt angles in degrees. */
const MAX_ROTATE_X = 6;
const MAX_ROTATE_Y = 4;

/** Perspective depth in px. */
const PERSPECTIVE = 1200;

/** Fraction at which text layers shift in the opposite direction. */
const TEXT_PARALLAX_FACTOR = 0.5;

export interface TiltStyle {
  /** Style for the outer container that carries the perspective and 3D rotate. */
  containerStyle: React.CSSProperties;
  /** Style for the background image layer (tilts at full rate). */
  imageStyle: React.CSSProperties;
  /** Style for text / overlay layers (shifts opposite direction, half rate). */
  textStyle: React.CSSProperties;
}

export interface UseTiltReturn extends TiltStyle {
  /** Spread these onto the outer section/div that the mouse tracks. */
  containerProps: {
    onMouseMove: (e: React.MouseEvent<HTMLElement>) => void;
    onMouseLeave: () => void;
  };
}

function isReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isTouchOnly(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(hover: none)').matches;
}

const STATIC: TiltStyle = {
  containerStyle: {},
  imageStyle: {},
  textStyle: {},
};

/**
 * useTilt — subtle CSS 3D parallax tilt driven by mouse position.
 *
 * Rules:
 * - Touch-primary devices (`hover: none`): completely disabled, no listeners.
 * - `prefers-reduced-motion: reduce`: completely static.
 * - `will-change: transform` applied only while pointer is inside the element.
 * - On mouse-leave: springs back via `transition: transform 0.4s ease-out`.
 * - All transforms applied via inline `style`, never Tailwind arbitrary values.
 */
export function useTilt(): UseTiltReturn {
  const disabledRef = useRef<boolean | null>(null);

  // Lazily resolve capability flags once on first use (SSR-safe).
  const isDisabled = useCallback((): boolean => {
    if (disabledRef.current === null) {
      disabledRef.current = isReducedMotion() || isTouchOnly();
    }
    return disabledRef.current;
  }, []);

  const [tilt, setTilt] = useState<{ rx: number; ry: number } | null>(null);
  const [hovered, setHovered] = useState(false);

  // Listen for reduced-motion changes at runtime and disable on the fly.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) {
        disabledRef.current = true;
        setTilt(null);
        setHovered(false);
      } else {
        // Re-evaluate: might still be touch-only.
        disabledRef.current = isTouchOnly();
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (isDisabled()) return;

      const rect = e.currentTarget.getBoundingClientRect();
      // Normalise to [-1, +1] relative to element centre.
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;

      // rotateX tilts around horizontal axis (positive = top toward viewer when mouse is low)
      // rotateY tilts around vertical axis (positive = right toward viewer when mouse is right)
      setTilt({ rx: -ny * MAX_ROTATE_X, ry: nx * MAX_ROTATE_Y });

      if (!hovered) setHovered(true);
    },
    [isDisabled, hovered],
  );

  const handleMouseLeave = useCallback(() => {
    if (isDisabled()) return;
    setTilt(null);
    setHovered(false);
  }, [isDisabled]);

  if (isDisabled() && tilt === null && !hovered) {
    return {
      ...STATIC,
      containerProps: {
        onMouseMove: () => {},
        onMouseLeave: () => {},
      },
    };
  }

  const transition = 'transform 0.4s ease-out';

  const containerStyle: React.CSSProperties = tilt
    ? {
        perspective: `${PERSPECTIVE}px`,
        willChange: 'transform',
        transition,
      }
    : {
        perspective: `${PERSPECTIVE}px`,
        willChange: 'auto',
        transition,
      };

  const imageStyle: React.CSSProperties = tilt
    ? {
        transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`,
        transformStyle: 'preserve-3d',
        willChange: 'transform',
        transition,
      }
    : {
        transform: 'rotateX(0deg) rotateY(0deg)',
        transformStyle: 'preserve-3d',
        willChange: 'auto',
        transition,
      };

  // Text shifts opposite direction at half rate (translateX/Y, no rotation).
  const textStyle: React.CSSProperties = tilt
    ? {
        transform: `translateX(${-(tilt.ry * TEXT_PARALLAX_FACTOR * 4)}px) translateY(${-(tilt.rx * TEXT_PARALLAX_FACTOR * 4)}px)`,
        willChange: 'transform',
        transition,
      }
    : {
        transform: 'translateX(0px) translateY(0px)',
        willChange: 'auto',
        transition,
      };

  return {
    containerStyle,
    imageStyle,
    textStyle,
    containerProps: {
      onMouseMove: handleMouseMove,
      onMouseLeave: handleMouseLeave,
    },
  };
}
