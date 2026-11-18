'use client';

import type { ReactNode } from 'react';
import { AmbientSky, useAmbientTheme } from '@/components/ambient/AmbientSky';
import { cn } from '@/lib/utils';
import { RoutinePeriodProvider, useRoutinePeriod } from '../hooks/RoutinePeriodProvider';

function Stage({ className, children }: { className?: string; children: ReactNode }) {
  const { period } = useRoutinePeriod();
  useAmbientTheme(period);

  return (
    <div className={cn('routine-stage', className)} data-period={period ?? undefined}>
      <AmbientSky calm />
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
