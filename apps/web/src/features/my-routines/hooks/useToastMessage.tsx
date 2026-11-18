'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Toast } from '@/components/ui/toast';

interface ToastState {
  text: string;
  action?: { label: string; onClick: () => void };
}

/**
 * One transient confirmation at a time, above the phone dock. Returns the element to render and a `show` function.
 * An action (undo) keeps the toast up longer so it can be reached.
 */
export function useToastMessage(): { toast: ReactNode; show: (text: string, action?: ToastState['action']) => void; hide: () => void } {
  const [state, setState] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setState(null);
  }, []);

  const show = useCallback((text: string, action?: ToastState['action']) => {
    if (timer.current) clearTimeout(timer.current);
    setState({ text, action: action ? { label: action.label, onClick: () => { action.onClick(); hide(); } } : undefined });
    timer.current = setTimeout(() => setState(null), action ? 7000 : 4000);
  }, [hide]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const toast = state ? (
    <div
      className="pointer-events-none fixed inset-x-3 z-toast flex justify-center lg:bottom-8"
      style={{ bottom: 'calc(var(--bottom-nav-height) + 5.5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <Toast className="pointer-events-auto w-full motion-safe:animate-rise-in lg:w-96" action={state.action}>
        {state.text}
      </Toast>
    </div>
  ) : null;

  return { toast, show, hide };
}
