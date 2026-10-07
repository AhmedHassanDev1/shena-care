const fs = require('fs');
const shopify = JSON.parse(fs.readFileSync('shopify_images.json', 'utf-8'));

const myProducts = [
  { id: 'eva-vitc-wash-150', q: 'vitamin c facial wash' },
  { id: 'eva-vitc-serum-20', q: 'vitamin c serum' },
  { id: 'eva-ha-serum-30', q: 'hyaluronic acid serum' },
  { id: 'eva-ha-day-gel-45', q: 'hyaluronic acid day gel' },
  { id: 'eva-acne-wash-150', q: 'acne-prone skin facial wash' },
  { id: 'eva-acne-sunscreen-40', q: 'acne-prone skin sunscreen' },
  { id: 'eva-collagen-wash-150', q: 'collagen facial wash' },
  { id: 'eva-collagen-filler-50', q: 'collagen fine lines filler' },
  
  { id: 'sv-acne-cleanser-200', q: 'starville acne prone skin cleanser' },
  { id: 'sv-acne-cream-60', q: 'starville acne prone skin cream' },
  { id: 'sv-whitening-cleanser-200', q: 'starville whitening cleanser' },
  { id: 'sv-whitening-cream-60', q: 'starville whitening cream' },

  { id: 'ha-frizz-off-shampoo-250', q: 'frizz off shampoo' },
  { id: 'ha-frizz-off-cond-250', q: 'frizz off conditioner' },
  { id: 'ha-frizz-off-leavein-250', q: 'frizz off leave-in' },
  { id: 'ha-lovebond-shampoo-250', q: 'lovebond shampoo' },
  { id: 'ha-lovebond-cond-250', q: 'lovebond conditioner' },

  { id: 'bless-activator-shampoo-300', q: 'activator shampoo' },
  { id: 'bless-activator-cond-300', q: 'activator conditioner' },
  { id: 'bless-activator-cream-250', q: 'defining cream' },
];

const results = {};

for (const p of myProducts) {
  // find closest match
  let bestMatch = null;
  let bestScore = 0;
  for (const [title, url] of Object.entries(shopify)) {
    const titleL = title.toLowerCase();
    let score = 0;
    for (const word of p.q.toLowerCase().split(/[\s-]+/)) {
      if (titleL.includes(word)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = url;
    }
  }
  results[p.id] = bestMatch;
}

fs.writeFileSync('mapped_images.json', JSON.stringify(results, null, 2));
console.log('Mapped images.');
