'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Scroll-aware FloatingNav (handoff §Visibility by page, NavBoard): on the PDP the nav hides while the customer
 * scrolls down and comes back above the purchase bar when they scroll up. Other pages keep it static.
 */
export function NavReveal({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    last.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last.current) < 8) return;
      setHidden(y > last.current && y > 120);
      last.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div className="nav-reveal" data-hidden={hidden || undefined}>
      {children}
    </div>
  );
}
