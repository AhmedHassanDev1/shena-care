const https = require('https');
const fs = require('fs');

const domains = [
  'shop.eva-cosmetics.com',
  'parkville.com.eg',
  'thehairaddict.net',
  'blessbotanicals.com'
];

async function fetchProducts(domain) {
  return new Promise((resolve) => {
    https.get(`https://${domain}/products.json?limit=250`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data).products);
        } catch(e) {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

async function run() {
  const allImages = {};
  for (const domain of domains) {
    const prods = await fetchProducts(domain);
    for (const p of prods) {
      if (p.images && p.images.length > 0) {
        allImages[p.title.toLowerCase()] = p.images[0].src;
      }
    }
  }
  fs.writeFileSync('shopify_images.json', JSON.stringify(allImages, null, 2));
  console.log(`Found ${Object.keys(allImages).length} products.`);
}
run();
