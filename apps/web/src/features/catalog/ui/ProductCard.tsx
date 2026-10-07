import { ProductView } from '../types/catalog.types';
import Link from 'next/link';
import { getMessages, type Locale } from '@/lib/i18n/messages';
import { formatCurrency } from '@/lib/i18n/format';
import { routes } from '@/lib/routes';

interface ProductCardProps {
  product: ProductView;
  locale: Locale;
}

export function ProductCard({ product, locale }: ProductCardProps) {
  const m = getMessages(locale);
  const primaryImage = product.media.find((m) => m.isPrimary) || product.media[0];
  const primarySku = product.skus[0];
  const price = primarySku?.price;

  return (
    <Link
      href={routes.product(product.slug)}
      className="product-card"
    >
      <div className="product-image">
        {primaryImage ? (
          <img src={primaryImage.url} alt={primaryImage.altText || product.name} />
        ) : (
          <div className="no-image">{m.noImage}</div>
        )}
      </div>

      <div className="product-info">
        <div className="brand-name">{product.brand.name}</div>
        <h3 className="product-name">{product.name}</h3>

        {price && (
          <div className="price-container">
            <span className="price">{formatCurrency(price.amount, price.currency, locale)}</span>
            {price.compareAtAmount != null && (
              <span className="compare-price">{formatCurrency(price.compareAtAmount, price.currency, locale)}</span>
            )}
          </div>
        )}

        {primarySku?.canOrder && (
          <div className="availability">{m.available}</div>
        )}
      </div>
    </Link>
  );
}
