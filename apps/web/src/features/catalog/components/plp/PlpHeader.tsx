'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Chip } from '@/components/ui/chip';
import { ProductTile } from '@/components/ui/product-tile';
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
  /** First products of the listing: their catalog images fill the banner's tilted prints (no campaign photography). */
  prints: CardModel[];
  tree: CategoryNode[] | undefined;
  filters: DiscoveryFilters;
  onNavigate: (next: DiscoveryFilters) => void;
}

const FIELD: Record<string, string> = { 'skin-care': 'bg-coral text-night', 'hair-care': 'field-sahel text-linen' };

/**
 * Listing header (PLP, PLPMobile, PLPStates «سياق الصفحة»): the department banner only on a department's first,
 * unfiltered page; a brand title in Latin caps with department pills; search results «نتايج «…»» with department
 * pills; a plain title + «بعد الفلترة» after filtering. Breadcrumbs everywhere.
 */
export function PlpHeader({ context, total, prints, tree, filters, onNavigate }: PlpHeaderProps) {
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

  if (context.kind === 'department') {
    const d = context.department;
    const title = categoryLabel(d, locale) ?? d.name;
    const list = d.children.map((child) => categoryLabel(child, locale) ?? child.name).join('، ');
    return (
      <section aria-labelledby="plp-h" className={cn('shutter-light warm relative min-h-[160px] rounded-24 px-5 pb-4 pt-2 shadow-elevation-1 lg:min-h-[212px] lg:rounded-sheet lg:px-10 lg:pb-6.5 lg:pt-3', FIELD[d.slug] ?? 'bg-sand text-night')}>
        <div>{crumbs(title)}</div>
        <div className="mt-1 flex max-w-[236px] flex-col gap-1 lg:max-w-[560px] lg:gap-2">
          <h1 id="plp-h" className="m-0 whitespace-nowrap font-display text-31 font-extrabold leading-36 lg:text-52 lg:leading-56">
            {title}
          </h1>
          {list ? <p className="m-0 text-13 leading-20 lg:text-15 lg:leading-26">{fillMessage(m.plpDeptBody, { list })}</p> : null}
        </div>
        {prints[0] ? (
          <span aria-hidden="true" className="absolute end-3.5 top-7 h-[104px] w-[78px] -rotate-3 overflow-hidden rounded-image shadow-elevation-2 lg:end-14 lg:top-5.5 lg:h-[168px] lg:w-[132px] lg:rounded-input ltr:rotate-3">
            <ProductTile src={prints[0].imageUrl} alt="" name={prints[0].name} className="h-full rounded-none" sizes="132px" />
          </span>
        ) : null}
        {prints[1] ? (
          <span aria-hidden="true" className="absolute end-[172px] top-10 hidden h-[146px] w-[116px] rotate-[4deg] overflow-hidden rounded-input shadow-elevation-2 lg:block ltr:-rotate-[4deg]">
            <ProductTile src={prints[1].imageUrl} alt="" name={prints[1].name} className="h-full rounded-none" sizes="116px" />
          </span>
        ) : null}
      </section>
    );
  }

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
