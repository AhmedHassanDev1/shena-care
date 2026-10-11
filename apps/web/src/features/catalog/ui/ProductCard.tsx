import Image from 'next/image';
import Link from 'next/link';
import { ProductView } from '../types/catalog.types';
import { getMessages, type Locale } from '@/lib/i18n/messages';
import { formatCurrency, formatNumber } from '@/lib/i18n/format';
import { routes } from '@/lib/routes';
import { Skeleton } from '@/components/ui/skeleton';
import { QuickAddButton } from './QuickAddButton';

interface ProductCardProps {
  product: ProductView;
  locale: Locale;
  variant?: 'default' | 'home';
}

const SIZE_UNITS_AR: Record<string, string> = { ml: 'مل', g: 'جم', l: 'لتر', kg: 'كجم', oz: 'أونصة', pcs: 'قطعة' };

function formatSize(size: number | null, unit: string | null, locale: Locale): string | null {
  if (size == null) return null;
  const value = formatNumber(size, locale);
  if (!unit) return value;
  return `${value} ${locale === 'ar' ? SIZE_UNITS_AR[unit.toLowerCase()] ?? unit : unit}`;
}

/**
 * Catalog data only: brand, name, size and price from the backend. Concern or routine-step chips need a
 * product contract that provides them (GLO-183) and must not be inferred here.
 */
export function ProductCard({ product, locale, variant = 'default' }: ProductCardProps) {
  const m = getMessages(locale);
  const primaryImage = product.media.find((media) => media.isPrimary) || product.media[0];
  const primarySku = product.skus.find((sku) => sku.canOrder) || product.skus[0];
  const price = primarySku?.price;
  const size = primarySku ? formatSize(primarySku.size, primarySku.sizeUnit, locale) : null;
  const href = routes.product(product.slug);

  return (
    <article className="group flex flex-col">
      {/* Edge-to-edge media on a warm neutral; white packshot backgrounds blend into it. */}
      <div className="relative aspect-[4/5] overflow-hidden rounded-md bg-secondary">
        <Link href={href} tabIndex={-1} aria-hidden="true" className="absolute inset-0">
          {primaryImage ? (
            <Image
              src={primaryImage.url}
              alt=""
              fill
              sizes={variant === 'home' ? '(min-width: 1024px) 280px, 50vw' : '(min-width: 768px) 280px, 50vw'}
              className="object-cover mix-blend-multiply transition-transform duration-base ease-standard group-hover:scale-[1.03]"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-caption text-muted-foreground">{m.noImage}</span>
          )}
        </Link>
        <div className="absolute inset-x-2 bottom-2">
          {primarySku?.canOrder && price ? (
            <QuickAddButton skuId={primarySku.id} productName={product.name} />
          ) : (
            <span className="flex h-10 w-full items-center justify-center rounded-sm bg-disabled text-support font-medium text-disabled-foreground">
              {m.unavailable}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-1 flex-col">
        <p className="text-caption font-semibold text-muted-foreground">
          <bdi>{product.brand.name}</bdi>
        </p>
        <h3 className="mt-0.5 line-clamp-2 text-support font-semibold text-foreground">
          <Link href={href} className="hover:underline">
            <bdi>{product.name}</bdi>
          </Link>
        </h3>
        {size ? <p className="mt-0.5 text-caption text-muted-foreground">{size}</p> : null}
        <div className="mt-auto flex flex-wrap items-baseline gap-x-2 pt-2">
          {price ? (
            <strong className="text-body font-semibold text-foreground">
              {formatCurrency(price.amount, price.currency, locale)}
            </strong>
          ) : null}
          {price?.compareAtAmount != null ? (
            <del className="text-caption text-muted-foreground">
              {formatCurrency(price.compareAtAmount, price.currency, locale)}
            </del>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="aspect-[4/5] w-full rounded-md" />
      <Skeleton className="mt-3 h-3 w-16" />
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="mt-3 h-5 w-20" />
    </div>
  );
}
