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
import { BrandLineHeader } from './BrandLineHeader';

interface PlpHeaderProps {
  context: ListingContext;
  total: number | null;
  prints?: CardModel[];
  tree: CategoryNode[] | undefined;
  filters: DiscoveryFilters;
  onNavigate: (next: DiscoveryFilters) => void;
  /** Department page: the subcategory selector, rendered directly under the title and description. */
  rail?: ReactNode;
  /** Brand Line page: the brand and line the discovery facets report for the current results. */
  /** Labels of the subcategories that hold sellable products; the one-line description lists only these. */
  typeLabels?: string[];
  line?: { brand: { slug: string; name: string } | undefined; name: string | undefined };
}

type Crumb = { href: string; label: string };

const CONCERN_METAS: Record<string, { crumb: string; title: string; desc: string }> = {
  acne: {
    crumb: 'حب الشباب',
    title: 'العناية بالبشرة المعرضة للحبوب',
    desc: 'اكتشف المنتجات المرتبطة باحتياج بشرتك.',
  },
  'blackheads-pimples': {
    crumb: 'الحبوب والرؤوس السوداء',
    title: 'العناية بالحبوب والرؤوس السوداء',
    desc: 'منتجات لطيفة لتنقية المسام وتوازن البشرة.',
  },
  dryness: {
    crumb: 'الجفاف والترطيب',
    title: 'العناية بالجفاف والترطيب',
    desc: 'منتجات غنية لاستعادة الترطيب وحاجز البشرة.',
  },
  'dark-spots': {
    crumb: 'البقع الداكنة',
    title: 'العناية بالبقع الداكنة وآثار الحبوب',
    desc: 'منتجات لتوحيد لون البشرة وتقليل التصبغات.',
  },
};

/**
 * Listing header (PLP, PLPMobile, PLPStates «سياق الصفحة»). A department page is compact: breadcrumb, title, one line
 * and the subcategory selector (`rail`) straight above the listing, with no trust badge or concern chips competing
 * for attention. A Brand Line page shows the brand identity and line (BrandLineHeader). Brand and search pages keep
 * their department pills; a plain title + «بعد الفلترة» after filtering. Breadcrumbs everywhere.
 */
export function PlpHeader({ context, total, tree, filters, onNavigate, rail, line, typeLabels }: PlpHeaderProps) {
  const m = useMessages();
  const locale = useLocale();
  const count = total === null ? null : fillMessage(m.plpCount, { n: formatNumber(total, locale) });

  const crumbs = (current: string, ...middle: Crumb[]) => (
    <nav aria-label={m.plpBreadcrumb}>
      <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0 text-12.5 leading-20 text-stone lg:text-13">
        {[{ href: routes.home, label: m.plpHome }, ...middle].map((step) => (
          <li key={step.href} className="inline-flex items-center gap-2">
            <Link href={step.href} className="inline-flex min-h-10 min-w-10 items-center justify-center font-medium text-stone hover:text-ink underline decoration-1 underline-offset-4">
              {step.label}
            </Link>
            <span aria-hidden="true" className="opacity-70">
              ›
            </span>
          </li>
        ))}
        <li aria-current="page" className="font-semibold text-ink">
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

  const trustBadge = (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sand px-2.5 py-0.5 text-12 font-bold text-ink" title={m.plpPharmacyTrust}>
      <span className="size-1.5 rounded-full bg-citron" />
      <span>{m.plpPharmacyBadge}</span>
    </span>
  );

  const plain = (title: string, body: ReactNode, crumb: ReactNode, aside?: ReactNode, titleLatin = false, trust = true) => (
    <section aria-labelledby="plp-h" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2.5">
        {crumb}
        {trust ? trustBadge : null}
      </div>
      <h1
        id="plp-h"
        lang={titleLatin ? 'en' : undefined}
        dir={titleLatin ? 'ltr' : undefined}
        className={cn('m-0 text-34 font-bold leading-tight text-ink md:text-44', titleLatin && 'font-serif italic font-normal')}
      >
        {title}
      </h1>
      {body ? <p className="m-0 text-14.5 leading-22 text-stone">{body}</p> : null}
      {aside ? <div className="pt-2">{aside}</div> : null}
    </section>
  );

  if (context.kind === 'department') {
    const d = context.department;
    const title = categoryLabel(d, locale) ?? d.name;
    const list = (typeLabels?.length ? typeLabels : d.children.map((child) => categoryLabel(child, locale) ?? child.name)).join('، ');
    const crumb = context.child
      ? crumbs(categoryLabel(context.child, locale) ?? context.child.name, { href: routes.productsByCategory(d.slug), label: title })
      : crumbs(title);
    return (
      <section aria-labelledby="plp-h" className="flex flex-col gap-3">
        {crumb}
        <div className="flex flex-col gap-1.5">
          <h1 id="plp-h" className="m-0 text-30 font-bold leading-tight text-ink md:text-34">
            {title}
          </h1>
          {list ? <p className="m-0 text-14.5 leading-22 text-stone">{list}</p> : null}
        </div>
        {rail ? (
          <div className="pt-1">
            <h2 className="sr-only">{m.plpSubcategories}</h2>
            {rail}
          </div>
        ) : null}
      </section>
    );
  }

  if (context.kind === 'line' && line) {
    const brandCrumbs: Crumb[] = [{ href: routes.products, label: m.plpBrands }];
    if (line.brand) brandCrumbs.push({ href: routes.productsByBrand(line.brand.slug), label: line.brand.name });
    return (
      <section aria-labelledby="plp-h" className="flex flex-col gap-3">
        {crumbs(line.name ?? context.line, ...brandCrumbs)}
        <BrandLineHeader lineSlug={context.line} brand={line.brand} lineName={line.name} total={total} />
      </section>
    );
  }

  if (context.kind === 'concern') {
    const meta = CONCERN_METAS[context.concern] ?? {
      crumb: context.concern,
      title: context.concern === 'acne' ? 'العناية بالبشرة المعرضة للحبوب' : context.concern,
      desc: 'اكتشف المنتجات المرتبطة باحتياج بشرتك.',
    };
    return plain(
      meta.title,
      meta.desc,
      crumbs(meta.crumb, { href: routes.corner, label: 'مشاكل البشرة' })
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
