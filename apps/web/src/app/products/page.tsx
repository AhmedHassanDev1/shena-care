import { getProducts } from '@/features/catalog/api/products';
import { ProductCard } from '@/features/catalog/ui/ProductCard';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export default async function ProductsPage() {
  const locale = getLocale();
  const m = getMessages(locale);
  const products = await getProducts();

  return (
    <div className="container">
      <h1 className="page-title">{m.ourProducts}</h1>

      {products.length === 0 ? (
        <p className="no-products">{m.noProducts}</p>
      ) : (
        <div className="products-grid">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}
