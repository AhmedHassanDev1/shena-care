import { getProduct } from '@/features/catalog/api/products';
import { ProductDetail } from '@/features/catalog/ui/ProductDetail';
import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/api-client';

interface ProductPageProps {
  params: {
    slug: string;
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  try {
    const product = await getProduct(params.slug);
    return <ProductDetail product={product} />;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
}
