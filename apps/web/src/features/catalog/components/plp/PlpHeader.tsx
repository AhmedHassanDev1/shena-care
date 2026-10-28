'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Chip } from '@/components/ui/chip';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { mainCategorySlugs, routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { DiscoveryFilters } from '../../api/discovery';
import { categoryLabel, type CardModel } from '../../lib/card-model';
import type { CategoryNode, ListingContext } from '../../lib/listing';

interface PlpHeaderProps {
  context: ListingContext;
  total: number | null;
  prints?: CardModel[];
  tree: CategoryNode[] | undefined;
  filters: DiscoveryFilters;
  onNavigate: (next: DiscoveryFilters) => void;
}

/**
 * Listing header (PLP, PLPMobile, PLPStates «سياق الصفحة»): the department banner only on a department's first,
 * unfiltered page; a brand title in Latin caps with department pills; search results «نتايج «…»» with department
 * pills; a plain title + «بعد الفلترة» after filtering. Breadcrumbs everywhere.
 */
export function PlpHeader({ context, total, tree, filters, onNavigate }: PlpHeaderProps) {
  const m = useMessages();
  const locale = useLocale();
  const count = total === null ? null : fillMessage(m.plpCount, { n: formatNumber(total, locale) });

  const crumbs = (current: string, middle?: { href: string; label: string }) => (
    <nav aria-label={m.plpBreadcrumb}>
      <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0 text-12.5 leading-20 lg:text-13">
        <li className="inline-flex items-center gap-2">
          <Link href={routes.home} className="inline-flex min-h-control-s min-w-control-s items-center justify-center font-medium text-inherit underline decoration-1 underline-offset-[5px]">
            {m.plpHome}
          </Link>
          <span aria-hidden="true" className="opacity-70">
            ›
          </span>
        </li>
        {middle ? (
          <li className="inline-flex items-center gap-2">
            <Link href={middle.href} className="inline-flex min-h-control-s min-w-control-s items-center justify-center font-medium text-inherit underline decoration-1 underline-offset-[5px]">
              {middle.label}
            </Link>
            <span aria-hidden="true" className="opacity-70">
              ›
            </span>
          </li>
        ) : null}
        <li aria-current="page" className="font-semibold">
          {current}
        </li>
      </ol>
    </nav>
  );

  const deptPills = (selected: string | undefined) =>
    tree?.length ? (
      <div role="group" aria-label={m.plpType} className="flex flex-wrap gap-2">
        <Chip selected={!selected} onClick={() => onNavigate({ ...filters, category: undefined })}>
          {m.plpAllDepts}
        </Chip>
        {tree.map((root) => (
          <Chip key={root.slug} selected={selected === root.slug} onClick={() => onNavigate({ ...filters, category: root.slug })}>
            {root.slug === mainCategorySlugs.skin ? m.navSkin : root.slug === mainCategorySlugs.hair ? m.navHair : categoryLabel(root, locale)}
          </Chip>
        ))}
      </div>
    ) : null;

  const plain = (title: string, body: ReactNode, crumb: ReactNode, aside?: ReactNode, titleLatin = false) => (
    <section aria-labelledby="plp-h" className="flex flex-col gap-2">
      {crumb}
      <h1
        id="plp-h"
        lang={titleLatin ? 'en' : undefined}
        dir={titleLatin ? 'ltr' : undefined}
        className={cn('m-0 text-display-1 text-match-parent', titleLatin && 'tracking-brand')}
      >
        {title}
      </h1>
      {body ? <p className="m-0 text-14.5 leading-22 text-ink-2">{body}</p> : null}
      {aside ? <div className="pt-2">{aside}</div> : null}
    </section>
  );

  if (context.kind === 'department') {
    const d = context.department;
    const title = categoryLabel(d, locale) ?? d.name;
    const list = d.children.map((child) => categoryLabel(child, locale) ?? child.name).join('، ');
    return plain(
      title,
      list ? fillMessage(m.plpDeptBody, { list }) : null,
      crumbs(title),
      deptPills(d.slug)
    );
  }

  if (context.kind === 'brand') {
    return plain(
      context.brand.toUpperCase(),
      count ? fillMessage(m.plpBrandBody, { brand: context.brand, n: count }) : null,
      crumbs(context.brand, { href: routes.products, label: m.plpBrands }),
      deptPills(filters.category),
      true
    );
  }
  if (context.kind === 'search') {
    return plain(fillMessage(m.plpSearchTitle, { q: context.q }), m.plpSearchBody, crumbs(m.plpSearchCrumb), deptPills(departmentSlug(filters, tree)));
  }
  if (context.kind === 'filtered') {
    const title = context.department ? categoryLabel(context.department, locale) ?? context.department.name : m.plpAllProducts;
    return plain(title, m.plpFiltered, crumbs(title));
  }
  return plain(m.plpAllProducts, null, crumbs(m.plpAllProducts));
}

function departmentSlug(filters: DiscoveryFilters, tree: CategoryNode[] | undefined) {
  if (!filters.category) return undefined;
  return tree?.find((root) => root.slug === filters.category || root.children.some((c) => c.slug === filters.category))?.slug;
}
