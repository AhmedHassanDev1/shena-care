'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { RoutinePeriodProvider, useRoutinePeriod } from '../hooks/RoutinePeriodProvider';
import './routine-atmosphere.css';

/**
 * Decorative shutter light, fixed behind the whole page (portalled to <body> so the translucent header and the glass cards
 * show it). Always aria-hidden and pointer-events none; it carries no information.
 */
function Sky() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);
  if (!host) return null;
  return createPortal(
    <div aria-hidden="true" className="routine-sky">
      <div className="routine-sky__layer routine-sky__am" />
      <div className="routine-sky__layer routine-sky__pm" />
    </div>,
    host
  );
}

function Stage({ className, children }: { className?: string; children: ReactNode }) {
  const { period } = useRoutinePeriod();

  // The theme lives on <html> (header, footer, sheets and the sky follow it); removed when the page closes.
  useEffect(() => {
    const root = document.documentElement;
    if (period) root.dataset.routineTheme = period;
    return () => {
      delete root.dataset.routineTheme;
    };
  }, [period]);

  return (
    <div className={cn('routine-stage', className)} data-period={period ?? undefined}>
      <Sky />
      {children}
    </div>
  );
}

/** The shared frame of the three routine pages: owns the Morning/Evening state and paints its light behind the content. */
export function RoutineStage({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <RoutinePeriodProvider>
      <Stage className={className}>{children}</Stage>
    </RoutinePeriodProvider>
  );
}
