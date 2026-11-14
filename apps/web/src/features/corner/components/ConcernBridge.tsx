'use client';

import { useQuery } from '@tanstack/react-query';
import { ChipLink } from '@/components/ui/chip-link';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { getConcernShelf } from '@/features/care/api/care-intelligence';

/**
 * The bridge from the category door to the concern door: on a Skin or Hair department page, the concerns of that care
 * area that have orderable products, each opening its Corner page. Renders nothing while loading, on error, or when no
 * concern has products (a dead link is worse than none); the category listing itself is never blocked by it.
 */
export function ConcernBridge({ departmentSlug }: { departmentSlug: string }) {
  const m = useMessages();
  const careArea = departmentSlug === mainCategorySlugs.skin ? 'skin' : departmentSlug === mainCategorySlugs.hair ? 'hair' : null;
  const shelf = useQuery({ queryKey: ['guidance', 'concerns'], queryFn: getConcernShelf, staleTime: 2 * 60 * 1000, enabled: careArea !== null });
  const concerns = (shelf.data ?? []).filter((c) => c.careArea === careArea && c.productCount > 0).sort((a, b) => b.productCount - a.productCount);
  if (!careArea || concerns.length === 0) return null;

  return (
    <nav aria-label={m.navConcerns} className="flex flex-wrap items-center gap-2">
      <span className="text-12.5 font-semibold text-stone">{m.navConcerns}</span>
      {concerns.slice(0, 6).map((concern) => (
        <ChipLink key={concern.slug} href={routes.cornerConcern(concern.slug)}>{concern.name}</ChipLink>
      ))}
    </nav>
  );
}
