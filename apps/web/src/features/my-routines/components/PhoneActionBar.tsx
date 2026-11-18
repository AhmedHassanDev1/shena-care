import type { ReactNode } from 'react';

/**
 * The phone's one primary action, pinned above the bottom dock (the same offset the product page's buy bar uses).
 * Hidden from lg up, where the page carries the same actions in its side column.
 */
export function PhoneActionBar({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="fixed inset-x-0 z-nav flex items-center gap-3 border-t border-ink/15 bg-chalk/95 px-4 py-3 backdrop-blur-md lg:hidden"
      style={{ bottom: 'calc(var(--bottom-nav-height) + 1.75rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {children}
    </div>
  );
}
