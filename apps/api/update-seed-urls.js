const fs = require('fs');

let seedFile = fs.readFileSync('src/platform/database/seed.ts', 'utf-8');
const mapped = JSON.parse(fs.readFileSync('mapped_images.json', 'utf-8'));

// manually fix the null one using another starville image
mapped['sv-whitening-cleanser-200'] = "https://cdn.shopify.com/s/files/1/0700/9488/0959/files/94349.jpg?v=1791198961";

const idToUrlMap = {
  'eva-vitc-wash-150': 'https://shop.eva-cosmetics.com/cdn/shop/files/vit_c_wash.jpg',
  'eva-vitc-serum-20': 'https://shop.eva-cosmetics.com/cdn/shop/files/vit_c_serum.jpg',
  'eva-ha-serum-30': 'https://shop.eva-cosmetics.com/cdn/shop/files/ha_serum.jpg',
  'eva-ha-day-gel-45': 'https://shop.eva-cosmetics.com/cdn/shop/files/ha_day_gel.jpg',
  'eva-acne-wash-150': 'https://shop.eva-cosmetics.com/cdn/shop/files/acne_wash.jpg',
  'eva-acne-sunscreen-40': 'https://shop.eva-cosmetics.com/cdn/shop/files/acne_sunscreen.jpg',
  'eva-collagen-wash-150': 'https://shop.eva-cosmetics.com/cdn/shop/files/collagen_wash.jpg',
  'eva-collagen-filler-50': 'https://shop.eva-cosmetics.com/cdn/shop/files/collagen_filler.jpg',
  'sv-acne-cleanser-200': 'https://parkville.com.eg/cdn/shop/files/starville_acne_cleanser.jpg',
  'sv-acne-cream-60': 'https://parkville.com.eg/cdn/shop/files/starville_acne_cream.jpg',
  'sv-whitening-cleanser-200': 'https://parkville.com.eg/cdn/shop/files/starville_whitening_cleanser.jpg',
  'sv-whitening-cream-60': 'https://parkville.com.eg/cdn/shop/files/starville_whitening_cream.jpg',
  'ha-frizz-off-shampoo-250': 'https://thehairaddict.net/cdn/shop/files/frizz_off_shampoo.jpg',
  'ha-frizz-off-cond-250': 'https://thehairaddict.net/cdn/shop/files/frizz_off_conditioner.jpg',
  'ha-frizz-off-leavein-250': 'https://thehairaddict.net/cdn/shop/files/frizz_off_leavein.jpg',
  'ha-lovebond-shampoo-250': 'https://thehairaddict.net/cdn/shop/files/lovebond_shampoo.jpg',
  'ha-lovebond-cond-250': 'https://thehairaddict.net/cdn/shop/files/lovebond_conditioner.jpg',
  'bless-activator-shampoo-300': 'https://blessbotanicals.com/cdn/shop/files/activator_shampoo.jpg',
  'bless-activator-cond-300': 'https://blessbotanicals.com/cdn/shop/files/activator_conditioner.jpg',
  'bless-activator-cream-250': 'https://blessbotanicals.com/cdn/shop/files/activator_cream.jpg'
};

for (const [id, oldUrl] of Object.entries(idToUrlMap)) {
  const newUrl = mapped[id];
  seedFile = seedFile.replace(oldUrl, newUrl);
}

fs.writeFileSync('src/platform/database/seed.ts', seedFile);
console.log('Seed file updated with valid images.');
