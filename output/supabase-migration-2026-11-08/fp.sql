select 'brands', count(*), md5(string_agg(b::text, '|' order by id)) from (select id,name,slug,description,logo_url,website_url,country_of_origin,is_active from catalog.brands) b
union all select 'products', count(*), md5(string_agg(p::text, '|' order by id)) from (select id,brand_id,name,slug,description,usage,warnings,is_published,category_id from catalog.products) p
union all select 'skus', count(*), md5(string_agg(s::text, '|' order by id)) from (select id,product_id,code,variant_name,size,size_unit,barcode,identity_status,barcode_status from catalog.skus) s
union all select 'product_media', count(*), md5(string_agg(m::text, '|' order by id)) from (select id,product_id,url,is_primary from catalog.product_media) m
union all select 'listings', count(*), md5(string_agg(l::text, '|' order by id)) from (select id from commerce.listings) l
union all select 'order_items', count(*), md5(string_agg(o::text, '|' order by id)) from (select id from ordering.order_items) o
union all select 'supplier_offers', count(*), md5(string_agg(x::text, '|' order by id)) from (select id from sourcing.supplier_offers) x
union all select 'import_rows', count(*), md5(string_agg(r::text, '|' order by id)) from (select id,decision,outcome from ingestion.admin_catalog_import_rows) r;
