export interface ProductView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  usage: string | null;
  warnings: string | null;
  brand: {
    id: string;
    name: string;
    slug: string;
  };
  skus: Array<{
    id: string;
    code: string;
    variantName: string;
    size: number | null;
    sizeUnit: string | null;
    price: {
      amount: number;
      currency: string;
      compareAtAmount: number | null;
    } | null;
    canOrder: boolean;
  }>;
  media: Array<{
    id: string;
    type: string;
    url: string;
    altText: string | null;
    isPrimary: boolean;
  }>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function getProducts(): Promise<ProductView[]> {
  const res = await fetch(`${API_URL}/products`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error('Failed to fetch products');
  }

  return res.json();
}

export async function getProduct(slugOrId: string): Promise<ProductView> {
  const res = await fetch(`${API_URL}/products/${slugOrId}`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error('Failed to fetch product');
  }

  return res.json();
}
