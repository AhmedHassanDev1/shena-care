import { ProductView } from '../api/products';

interface ProductDetailProps {
  product: ProductView;
}

export function ProductDetail({ product }: ProductDetailProps) {
  const primaryImage = product.media.find((m) => m.isPrimary) || product.media[0];

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
          <div className="no-image-large">No image available</div>
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

        <div className="variants-section">
          <h3>Available Variants</h3>
          {product.skus.map((sku) => (
            <div key={sku.id} className="variant-card">
              <div className="variant-info">
                <div className="variant-name">{sku.variantName}</div>
                {sku.size && (
                  <div className="variant-size">
                    {sku.size} {sku.sizeUnit}
                  </div>
                )}
              </div>

              {sku.price && (
                <div className="variant-price">
                  <span className="price">${sku.price.amount.toFixed(2)}</span>
                  {sku.price.compareAtAmount && (
                    <span className="compare-price">
                      ${sku.price.compareAtAmount.toFixed(2)}
                    </span>
                  )}
                </div>
              )}

              {sku.canOrder ? (
                <button className="add-to-cart-btn">Add to Cart</button>
              ) : (
                <div className="unavailable">Currently unavailable</div>
              )}
            </div>
          ))}
        </div>

        {product.usage && (
          <div className="usage-section">
            <h3>How to Use</h3>
            <p>{product.usage}</p>
          </div>
        )}

        {product.warnings && (
          <div className="warnings-section">
            <h3>Warnings</h3>
            <p>{product.warnings}</p>
          </div>
        )}
      </div>
    </div>
  );
}
