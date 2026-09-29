import { ProductView } from '../api/products';

interface ProductCardProps {
  product: ProductView;
}

export function ProductCard({ product }: ProductCardProps) {
  const primaryImage = product.media.find((m) => m.isPrimary) || product.media[0];
  const primarySku = product.skus[0];
  const price = primarySku?.price;

  return (
    <a
      href={`/products/${product.slug}`}
      className="product-card"
    >
      <div className="product-image">
        {primaryImage ? (
          <img src={primaryImage.url} alt={primaryImage.altText || product.name} />
        ) : (
          <div className="no-image">No image</div>
        )}
      </div>

      <div className="product-info">
        <div className="brand-name">{product.brand.name}</div>
        <h3 className="product-name">{product.name}</h3>

        {price && (
          <div className="price-container">
            <span className="price">${price.amount.toFixed(2)}</span>
            {price.compareAtAmount && (
              <span className="compare-price">${price.compareAtAmount.toFixed(2)}</span>
            )}
          </div>
        )}

        {primarySku?.canOrder && (
          <div className="availability">Available</div>
        )}
      </div>
    </a>
  );
}
