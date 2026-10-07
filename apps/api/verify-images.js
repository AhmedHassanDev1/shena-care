const https = require('https');
const http = require('http');

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

async function checkUrl(url, redirects = 0) {
  if (redirects > 5) return { status: 500, type: null, error: 'Too many redirects' };
  
  return new Promise((resolve) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      const status = res.statusCode;
      if (status >= 300 && status < 400 && res.headers.location) {
        req.destroy();
        resolve(checkUrl(res.headers.location, redirects + 1));
        return;
      }
      
      const type = res.headers['content-type'];
      res.destroy(); // Abort downloading the full body
      resolve({ status, type, url: res.url || url });
    });
    
    req.on('error', (e) => {
      resolve({ status: 0, type: null, error: e.message });
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ status: 0, type: null, error: 'Timeout' });
    });
  });
}

async function run() {
  const results = [];
  for (const url of images) {
    const res = await checkUrl(url);
    results.push({ url, ...res });
    console.log(`[${res.status}] ${res.type || 'unknown'} - ${url} ${res.error ? '(' + res.error + ')' : ''}`);
  }
  console.log('--- DONE ---');
}

run();
