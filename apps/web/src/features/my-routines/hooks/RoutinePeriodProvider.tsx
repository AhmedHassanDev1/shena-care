'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { initialPeriod, isRoutinePeriod, PERIOD_STORAGE_KEY, ROUTINE_PERIOD_CONFIG, serializeChoice, type PeriodConfig, type RoutinePeriod } from '../lib/period';

interface PeriodContextValue {
  /** Null only before the browser clock has been read (server render and first paint); pages render neutral until then. */
  period: RoutinePeriod | null;
  /** The customer's own choice. Remembered for a few minutes so the three routine pages agree; after that the local clock decides again. */
  choose: (period: RoutinePeriod) => void;
}

const PeriodContext = createContext<PeriodContextValue | null>(null);

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(PERIOD_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Morning/Evening for a routine page. The browser-local clock sets the default exactly once, on entry; after that only the
 * customer changes it. There is deliberately no timer here: a page left open past 18:00 stays on what the customer chose.
 */
export function RoutinePeriodProvider({ children, config = ROUTINE_PERIOD_CONFIG }: { children: ReactNode; config?: PeriodConfig }) {
  const [period, setPeriod] = useState<RoutinePeriod | null>(null);

  useEffect(() => {
    setPeriod(initialPeriod(readStored(), new Date(), config));
    // The default is applied on entry only; a changed config object must not re-run it over a manual choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = useCallback((next: RoutinePeriod) => {
    setPeriod(next);
    try {
      window.sessionStorage.setItem(PERIOD_STORAGE_KEY, serializeChoice(next, Date.now()));
    } catch {
      /* storage can be blocked; the choice still holds for this page */
    }
  }, []);

  const value = useMemo(() => ({ period, choose }), [period, choose]);
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function useRoutinePeriod(): PeriodContextValue {
  const value = useContext(PeriodContext);
  if (!value) throw new Error('useRoutinePeriod must be used inside RoutinePeriodProvider');
  return value;
}

export { isRoutinePeriod };
