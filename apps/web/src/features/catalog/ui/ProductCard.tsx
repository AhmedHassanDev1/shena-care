import Image from 'next/image';
import Link from 'next/link';
import { Heart, Plus } from 'lucide-react';
import { ProductView } from '../types/catalog.types';
import { getMessages, type Locale } from '@/lib/i18n/messages';
import { formatCurrency } from '@/lib/i18n/format';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

interface ProductCardProps {
  product: ProductView;
  locale: Locale;
  variant?: 'default' | 'home';
}

export function ProductCard({ product, locale, variant = 'default' }: ProductCardProps) {
  const m = getMessages(locale);
  const primaryImage = product.media.find((media) => media.isPrimary) || product.media[0];
  const primarySku = product.skus.find((sku) => sku.canOrder) || product.skus[0];
  const price = primarySku?.price;

  return (
    <article className={cn('commerce-product-card', variant === 'home' && 'is-home-card')}>
      <Link href={routes.product(product.slug)} className="product-card-image" aria-label={'View ' + product.name}>
        {primaryImage ? (
          <Image
            src={primaryImage.url}
            alt={primaryImage.altText || product.name}
            fill
            sizes={variant === 'home' ? '(max-width: 767px) 43vw, 20vw' : '(max-width: 767px) 45vw, 280px'}
          />
        ) : (
          <span>{m.noImage}</span>
        )}
      </Link>
      <span className="wishlist-mark" aria-hidden="true"><Heart /></span>

      <div className="product-card-copy">
        {/* Only backend data here. Concern and routine-step chips need a product contract that
            provides them (GLO-183); they must not be inferred from the category. */}
        <div className="product-chips">
          <span><bdi>{product.brand.name}</bdi></span>
        </div>
        <Link href={routes.product(product.slug)}>
          <h3>{product.name}</h3>
          <p>{product.description}</p>
        </Link>
        <div className="product-price-row">
          <div>
            {price ? <strong>{formatCurrency(price.amount, price.currency, locale)}</strong> : null}
            {price?.compareAtAmount != null ? <del>{formatCurrency(price.compareAtAmount, price.currency, locale)}</del> : null}
          </div>
          <Link href={routes.product(product.slug)} className="add-product-link" aria-label={'View ' + product.name}>
            <Plus aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
