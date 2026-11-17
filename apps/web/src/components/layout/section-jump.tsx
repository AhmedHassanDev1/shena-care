'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { PageContainer } from './page-container';

export interface SectionJumpItem {
  /** DOM id of the section the link scrolls to. */
  id: string;
  label: string;
}

/**
 * In-page jump links for long information pages (concern page, product page). The section in view is marked with
 * `aria-current="location"` as well as colour. Sticky under the header on desktop, a plain swipeable row on phones
 * where the header already takes two rows.
 */
export function SectionJump({ items, label }: { items: SectionJumpItem[]; label: string }) {
  const [current, setCurrent] = useState<string | null>(null);
  const key = items.map((i) => i.id).join('|');

  useEffect(() => {
    const els = key
      .split('|')
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setCurrent(visible.target.id);
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [key]);

  if (items.length < 2) return null;
  return (
    <nav aria-label={label} className="z-10 border-y border-line bg-chalk/95 backdrop-blur lg:sticky lg:top-header-height">
      <PageContainer>
        <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 py-2 no-scrollbar">
          {items.map((item) => (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                aria-current={current === item.id ? 'location' : undefined}
                className={cn(
                  'inline-flex h-control-s items-center rounded-pill px-4 font-display text-15 font-semibold transition-colors duration-fast',
                  current === item.id ? 'bg-ink text-chalk' : 'text-stone hover:bg-sand hover:text-ink',
                )}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </PageContainer>
    </nav>
  );
}
