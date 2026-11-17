'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { RoutinePeriodProvider, useRoutinePeriod } from '../hooks/RoutinePeriodProvider';
import './routine-atmosphere.css';

/** Decorative light behind the page. Always aria-hidden and pointer-events none; it carries no information. */
function Sky() {
  return (
    <div aria-hidden="true" className="routine-sky">
      <div className="routine-sky__layer routine-sky__am">
        <div className="routine-sky__rays" />
      </div>
      <div className="routine-sky__layer routine-sky__pm">
        <div className="routine-sky__stars" />
        <div className="routine-sky__moon" />
      </div>
    </div>
  );
}

function Stage({ className, children }: { className?: string; children: ReactNode }) {
  const { period } = useRoutinePeriod();
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
      <Stage className={cn('-mb-24 pb-24 lg:mb-0 lg:pb-0', className)}>{children}</Stage>
    </RoutinePeriodProvider>
  );
}
