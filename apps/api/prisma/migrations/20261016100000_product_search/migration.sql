-- Product search uses the same normalization for query text and indexed catalog fields.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

ALTER TABLE catalog.products ADD COLUMN concerns TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE FUNCTION catalog.search_normalize(value TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    translate(regexp_replace(lower(value), '[ً-ٰٟـ]', '', 'g'), 'إأآٱىة', 'اااايه'),
    '[[:space:]]+', ' ', 'g'));
$$;

CREATE INDEX products_search_name_idx ON catalog.products USING gin (catalog.search_normalize(name) public.gin_trgm_ops);
CREATE INDEX products_search_name_prefix_idx ON catalog.products (catalog.search_normalize(name) text_pattern_ops);
CREATE INDEX products_search_concerns_idx ON catalog.products USING gin (concerns);
CREATE INDEX brands_search_name_idx ON catalog.brands USING gin (catalog.search_normalize(name) public.gin_trgm_ops);
CREATE INDEX brands_search_name_prefix_idx ON catalog.brands (catalog.search_normalize(name) text_pattern_ops);
CREATE INDEX skus_search_code_idx ON catalog.skus USING gin (catalog.search_normalize(code) public.gin_trgm_ops);
CREATE INDEX skus_search_code_prefix_idx ON catalog.skus (catalog.search_normalize(code) text_pattern_ops);
CREATE INDEX skus_search_barcode_idx ON catalog.skus USING gin (catalog.search_normalize(COALESCE(barcode, '')) public.gin_trgm_ops);
CREATE INDEX skus_search_variant_idx ON catalog.skus USING gin (catalog.search_normalize(variant_name) public.gin_trgm_ops);
