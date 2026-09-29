import { getProducts } from '@/features/catalog/api/products';
import { ProductCard } from '@/features/catalog/ui/ProductCard';

export default async function ProductsPage() {
  const products = await getProducts();

  return (
    <div className="container">
      <h1 className="page-title">Our Products</h1>

      {products.length === 0 ? (
        <p className="no-products">No products available at this time.</p>
      ) : (
        <div className="products-grid">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
