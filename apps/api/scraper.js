const { request } = require('undici');
const cheerio = require('cheerio');

const queries = [
  "Eva Skin Clinic Vitamin C Facial Wash And Exfoliator 150 ml",
  "Eva Skin Clinic Vitamin C Facial Serum 20 ml",
  "Eva Skin Clinic Hyaluronic Acid Facial Serum 30 ml",
  "Eva Skin Clinic Hyaluronic Acid Day Gel 45 ml",
  "Eva Skin Clinic Acne-Prone Skin Fresh Restart Facial Wash 150 ml",
  "Eva Skin Clinic Acne-Prone Skin Sunscreen SPF 50+ 40 ml",
  "Eva Skin Clinic Anti-Ageing Collagen Facial Wash 150 ml",
  "Eva Skin Clinic Anti-Ageing Collagen Fine Lines Filler 50 ml",
  "StarVille Acne Prone Skin Facial Cleanser 200 ml",
  "StarVille Acne Prone Skin Cream 60 gm",
  "StarVille Whitening Cleanser 200 ml",
  "StarVille Whitening Cream 60 gm",
  "Frizz Off Shampoo The Hair Addict 250 ml",
  "Frizz Off Conditioner The Hair Addict 250 ml",
  "Frizz Off Leave-In Conditioner The Hair Addict 250 ml",
  "LoveBond Shampoo The Hair Addict 250 ml",
  "LoveBond Conditioner The Hair Addict 250 ml",
  "Activator Shampoo BLESS 300 ml",
  "Activator Conditioner BLESS 300 ml",
  "Activator Defining Cream BLESS 250 ml"
];

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function search(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const { body } = await request(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    const html = await body.text();
    const $ = cheerio.load(html);
    let results = [];
    $('.result__snippet').each((i, el) => {
      results.push($(el).text().trim());
    });
    return results[0] || '';
  } catch (e) {
    return e.message;
  }
}

async function run() {
  const data = {};
  for (const q of queries) {
    console.log(`Searching: ${q}`);
    data[q] = await search(q);
    await delay(1000);
  }
  console.log(JSON.stringify(data, null, 2));
}

run();
