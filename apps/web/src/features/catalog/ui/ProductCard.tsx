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

const stepByCategory: Record<string, { step: number; label: string; concern: string }> = {
  cleansers: { step: 1, label: 'Cleanse', concern: 'Fresh Start' },
  shampoos: { step: 1, label: 'Cleanse', concern: 'Hair Care' },
  'serums-treatments': { step: 2, label: 'Treat', concern: 'Dark Spots' },
  'hair-treatments-styling': { step: 2, label: 'Treat', concern: 'Hair Fall' },
  moisturizers: { step: 3, label: 'Moisturize', concern: 'Dryness' },
  conditioners: { step: 3, label: 'Condition', concern: 'Dryness' },
  sunscreens: { step: 4, label: 'Protect', concern: 'Sensitive Skin' },
};

export function ProductCard({ product, locale, variant = 'default' }: ProductCardProps) {
  const m = getMessages(locale);
  const primaryImage = product.media.find((media) => media.isPrimary) || product.media[0];
  const primarySku = product.skus.find((sku) => sku.canOrder) || product.skus[0];
  const price = primarySku?.price;
  const categorySlug = typeof product.category === 'object' ? product.category?.slug : '';
  const step = stepByCategory[categorySlug || ''] || { step: 2, label: 'Treat', concern: product.brand.name };

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
        <div className="product-chips">
          <span>{step.concern}</span>
          <span>Step {step.step} · {step.label}</span>
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
