const fs = require('fs');
const https = require('https');

const products = [
  { id: 'eva-vitc-wash-150', q: 'Eva Skin Clinic Vitamin C Facial Wash', site: 'eva-cosmetics.com' },
  { id: 'eva-vitc-serum-20', q: 'Eva Skin Clinic Vitamin C Facial Serum', site: 'eva-cosmetics.com' },
  { id: 'eva-ha-serum-30', q: 'Eva Skin Clinic Hyaluronic Acid Facial Serum', site: 'eva-cosmetics.com' },
  { id: 'eva-ha-day-gel-45', q: 'Eva Skin Clinic Hyaluronic Acid Day Gel', site: 'eva-cosmetics.com' },
  { id: 'eva-acne-wash-150', q: 'Eva Skin Clinic Acne-Prone Skin "Fresh Restart" Facial Wash', site: 'eva-cosmetics.com' },
  { id: 'eva-acne-sunscreen-40', q: 'Eva Skin Clinic Acne-Prone Skin Sunscreen SPF 50+', site: 'eva-cosmetics.com' },
  { id: 'eva-collagen-wash-150', q: 'Eva Skin Clinic Anti-Ageing Collagen Facial Wash', site: 'eva-cosmetics.com' },
  { id: 'eva-collagen-filler-50', q: 'Eva Skin Clinic Anti-Ageing Collagen Fine Lines Filler', site: 'eva-cosmetics.com' },
  
  { id: 'sv-acne-cleanser-200', q: 'StarVille Acne Prone Skin Facial Cleanser', site: 'parkville.com.eg' },
  { id: 'sv-acne-cream-60', q: 'StarVille Acne Prone Skin Cream', site: 'parkville.com.eg' },
  { id: 'sv-whitening-cleanser-200', q: 'StarVille Whitening Cleanser', site: 'parkville.com.eg' },
  { id: 'sv-whitening-cream-60', q: 'StarVille Whitening Cream', site: 'parkville.com.eg' },

  { id: 'ha-frizz-off-shampoo-250', q: 'Frizz Off Shampoo', site: 'thehairaddict.net' },
  { id: 'ha-frizz-off-cond-250', q: 'Frizz Off Conditioner', site: 'thehairaddict.net' },
  { id: 'ha-frizz-off-leavein-250', q: 'Frizz Off Leave-In Conditioner', site: 'thehairaddict.net' },
  { id: 'ha-lovebond-shampoo-250', q: 'LoveBond Shampoo', site: 'thehairaddict.net' },
  { id: 'ha-lovebond-cond-250', q: 'LoveBond Conditioner', site: 'thehairaddict.net' },

  { id: 'bless-activator-shampoo-300', q: 'Activator Shampoo', site: 'blessbotanicals.com' },
  { id: 'bless-activator-cond-300', q: 'Activator Conditioner', site: 'blessbotanicals.com' },
  { id: 'bless-activator-cream-250', q: 'Activator Defining Cream', site: 'blessbotanicals.com' },
];

async function fetchHTML(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', () => resolve(''));
  });
}

async function findImage(p) {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(p.q + ' site:' + p.site)}`;
  const html = await fetchHTML(searchUrl);
  // Very crude extraction of the first link that might be a product page
  const linkMatch = html.match(/href="([^"]+)"[^>]*class="result__url"/);
  let finalImg = null;
  if (linkMatch) {
    let url = linkMatch[1];
    if (url.startsWith('//')) url = 'https:' + url;
    if (url.startsWith('/url?q=')) url = decodeURIComponent(url.split('/url?q=')[1].split('&')[0]);
    
    // Now fetch that product page and find a likely image
    const pageHtml = await fetchHTML(url);
    // Look for og:image or any img with product name
    const ogMatch = pageHtml.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
    if (ogMatch) {
      finalImg = ogMatch[1];
    } else {
      const imgMatch = pageHtml.match(/<img[^>]+src="([^"]+\.(?:jpg|png|webp))"/i);
      if (imgMatch) finalImg = imgMatch[1];
    }
    
    if (finalImg) {
      if (finalImg.startsWith('//')) finalImg = 'https:' + finalImg;
      else if (finalImg.startsWith('/')) {
        const parsed = new URL(url);
        finalImg = `${parsed.protocol}//${parsed.host}${finalImg}`;
      }
    }
  }
  return finalImg;
}

async function run() {
  const res = {};
  for (const p of products) {
    console.log(`Searching for ${p.id}...`);
    const img = await findImage(p);
    res[p.id] = img;
    console.log(`  -> ${img}`);
    // sleep
    await new Promise(r => setTimeout(r, 1000));
  }
  fs.writeFileSync('images.json', JSON.stringify(res, null, 2));
}

run();
