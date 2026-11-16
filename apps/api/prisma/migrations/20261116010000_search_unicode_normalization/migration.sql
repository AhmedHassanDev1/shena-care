-- Match the public Arabic/English search query fold, including native digit forms.
CREATE OR REPLACE FUNCTION catalog.search_normalize(value TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    translate(regexp_replace(lower(normalize(value, NFKC)),
      U&'[ً-ٰٟـ\00AD\0600-\0605\061C\06DD\070F\0890-\0891\08E2\180E\200B-\200F\202A-\202E\2060-\2064\2066-\206F\FEFF\FFF9-\FFFB\+0110BD\+0110CD\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0001\+0E0020-\+0E007F]', '', 'g'),
      'إأآٱىةؤئ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
      'اااايهوي01234567890123456789'),
    '[[:space:]]+', ' ', 'g'));
$$;

-- Function-backed indexes must be rebuilt when normalization semantics change.
REINDEX INDEX catalog.products_search_name_idx;
REINDEX INDEX catalog.products_search_name_prefix_idx;
REINDEX INDEX catalog.brands_search_name_idx;
REINDEX INDEX catalog.brands_search_name_prefix_idx;
REINDEX INDEX catalog.skus_search_code_idx;
REINDEX INDEX catalog.skus_search_code_prefix_idx;
REINDEX INDEX catalog.skus_search_barcode_idx;
REINDEX INDEX catalog.skus_search_variant_idx;
