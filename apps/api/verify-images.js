const images = [
  'https://shop.eva-cosmetics.com/cdn/shop/files/vit_c_wash.jpg',
  'https://shop.eva-cosmetics.com/cdn/shop/files/vit_c_serum.jpg',
  'https://shop.eva-cosmetics.com/cdn/shop/files/ha_serum.jpg',
  'https://shop.eva-cosmetics.com/cdn/shop/files/ha_day_gel.jpg',
  'https://shop.eva-cosmetics.com/cdn/shop/files/acne_wash.jpg',
  'https://shop.eva-cosmetics.com/cdn/shop/files/acne_sunscreen.jpg',
  'https://shop.eva-cosmetics.com/cdn/shop/files/collagen_wash.jpg',
  'https://shop.eva-cosmetics.com/cdn/shop/files/collagen_filler.jpg',
  'https://parkville.com.eg/cdn/shop/files/starville_acne_cleanser.jpg',
  'https://parkville.com.eg/cdn/shop/files/starville_acne_cream.jpg',
  'https://parkville.com.eg/cdn/shop/files/starville_whitening_cleanser.jpg',
  'https://parkville.com.eg/cdn/shop/files/starville_whitening_cream.jpg',
  'https://thehairaddict.net/cdn/shop/files/frizz_off_shampoo.jpg',
  'https://thehairaddict.net/cdn/shop/files/frizz_off_conditioner.jpg',
  'https://thehairaddict.net/cdn/shop/files/frizz_off_leavein.jpg',
  'https://thehairaddict.net/cdn/shop/files/lovebond_shampoo.jpg',
  'https://thehairaddict.net/cdn/shop/files/lovebond_conditioner.jpg',
  'https://blessbotanicals.com/cdn/shop/files/activator_shampoo.jpg',
  'https://blessbotanicals.com/cdn/shop/files/activator_conditioner.jpg',
  'https://blessbotanicals.com/cdn/shop/files/activator_cream.jpg'
];

async function check() {
  for (const url of images) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      console.log(res.status, url);
    } catch (e) {
      console.log('ERROR', url, e.message);
    }
  }
}
check();
