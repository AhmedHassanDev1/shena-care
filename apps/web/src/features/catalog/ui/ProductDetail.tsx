'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProductView } from '../api/products';
import { cart } from '@/lib/cart';
import { auth } from '@/lib/auth';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatCurrency, formatNumber } from '@/lib/i18n/format';
import { routes } from '@/lib/routes';

interface ProductDetailProps {
  product: ProductView;
}

export function ProductDetail({ product }: ProductDetailProps) {
  const router = useRouter();
  const locale = useLocale();
  const m = useMessages();
  const primaryImage = product.media.find((m) => m.isPrimary) || product.media[0];
  const [addingToCart, setAddingToCart] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleAddToCart = async (skuId: string) => {
    if (!auth.isAuthenticated()) {
      router.push(routes.login);
      return;
    }

    setAddingToCart(skuId);
    setMessage(null);

    try {
      await cart.addToCart(skuId, 1);
      setMessage({ type: 'success', text: m.addedToCart });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 401) {
        router.push(routes.login);
      } else {
        setMessage({ type: 'error', text: m.addToCartFailed });
      }
    } finally {
      setAddingToCart(null);
    }
  };

  return (
    <div className="product-detail">
      <div className="product-gallery">
        {primaryImage ? (
          <img
            src={primaryImage.url}
            alt={primaryImage.altText || product.name}
            className="main-image"
          />
        ) : (
          <div className="no-image-large">{m.noImageAvailable}</div>
        )}
      </div>

      <div className="product-details">
        <div className="brand-name">{product.brand.name}</div>
        <h1 className="product-title">{product.name}</h1>

        {product.description && (
          <div className="product-description">
            <p>{product.description}</p>
          </div>
        )}

        {message && (
          <div className={message.type === 'success' ? 'success-message' : 'error-message'}>
            {message.text}
          </div>
        )}

        <div className="variants-section">
          <h3>{m.availableVariants}</h3>
          {product.skus.map((sku) => (
            <div key={sku.id} className="variant-card">
              <div className="variant-info">
                <div className="variant-name">{sku.variantName}</div>
                {sku.size && (
                  <div className="variant-size">
                  {formatNumber(sku.size, locale)} {sku.sizeUnit}
                  </div>
                )}
              </div>

              {sku.price && (
                <div className="variant-price">
                  <span className="price">{formatCurrency(sku.price.amount, sku.price.currency, locale)}</span>
                  {sku.price.compareAtAmount != null && (
                    <span className="compare-price">
                      {formatCurrency(sku.price.compareAtAmount, sku.price.currency, locale)}
                    </span>
                  )}
                </div>
              )}

              {sku.canOrder ? (
                <button
                  className="add-to-cart-btn"
                  onClick={() => handleAddToCart(sku.id)}
                  disabled={addingToCart === sku.id}
                >
                  {addingToCart === sku.id ? m.adding : m.addToCart}
                </button>
              ) : (
                <div className="unavailable">{m.unavailable}</div>
              )}
            </div>
          ))}
        </div>

        {product.usage && (
          <div className="usage-section">
            <h3>{m.howToUse}</h3>
            <p>{product.usage}</p>
          </div>
        )}

        {product.warnings && (
          <div className="warnings-section">
            <h3>{m.warnings}</h3>
            <p>{product.warnings}</p>
          </div>
        )}
      </div>
    </div>
  );
}
