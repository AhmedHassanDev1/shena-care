/** Keep the discovery service's ranking, without showing the current item twice. */
export function selectRelatedProducts<T extends { id: string }>(products: T[], currentId: string, limit: number): T[] {
  const seen = new Set([currentId]);
  return products.filter((product) => {
    if (seen.has(product.id)) return false;
    seen.add(product.id);
    return true;
  }).slice(0, limit);
}
