export interface SearchFilters {
  q: string;
  category?: string;
  brand?: string;
  productLine?: string;
  concern?: string;
  matchedConcern?: string;
  snapshotAt: Date;
}

/** Ordered product identities. Commerce and availability gates remain with composition. */
export interface SearchProvider {
  search(filters: SearchFilters): Promise<string[]>;
  suggest(filters: SearchFilters, limit: number): Promise<string[]>;
}

export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER');
