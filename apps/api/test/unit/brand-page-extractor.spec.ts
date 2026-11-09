import { cleanSiteName, extractBrandPage } from '../../src/modules/catalog/research/brand-page-extractor';

const PAGE = 'https://www.lumora.example/';

describe('Brand page extractor', () => {
  it('reads only what structured data and meta tags literally state', () => {
    const facts = extractBrandPage(`<html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"WebSite","name":"Lumora"},
        {"@type":"Organization","name":"Lumora","alternateName":["لومورا","Lumora Skincare"],"description":"Dermatologist-developed skincare for sensitive skin.",
         "logo":{"@type":"ImageObject","url":"/assets/logo.png"},"parentOrganization":{"@type":"Organization","name":"Acme Beauty Group"},
         "foundingLocation":{"@type":"Place","name":"France"},"address":{"@type":"PostalAddress","addressCountry":"EG"}}]}</script>
      <meta property="og:site_name" content="Lumora &amp; Co"><meta name="description" content="A page description that is long enough to be kept."></head><body></body></html>`, PAGE);
    expect(facts.names.map(n => n.value)).toEqual(['Lumora', 'Lumora & Co']);
    expect(facts.alternateNames.map(n => n.value)).toEqual(['لومورا', 'Lumora Skincare']);
    expect(facts.description).toMatchObject({ value: 'Dermatologist-developed skincare for sensitive skin.', source: 'JSON_LD' });
    expect(facts.logoCandidates[0]).toMatchObject({ value: 'https://www.lumora.example/assets/logo.png', source: 'JSON_LD' });
    expect(facts.parentCompany?.value).toBe('Acme Beauty Group');
    expect(facts.foundingCountry?.value).toBe('France');
    // The address country is reported separately, as the company's address — never as the brand's origin.
    expect(facts.addressCountry?.value).toBe('Egypt');
  });

  it('never invents: an empty or hostile page yields nothing', () => {
    const empty = extractBrandPage('<html><body><p>Welcome</p></body></html>', PAGE);
    expect(empty).toMatchObject({ names: [], alternateNames: [], description: null, logoCandidates: [], foundingCountry: null, addressCountry: null, parentCompany: null });
    const broken = extractBrandPage('<script type="application/ld+json">{not json</script><meta name="description" content="short">', PAGE);
    expect(broken.names).toEqual([]);
    expect(broken.description).toBeNull();
  });

  it('accepts only https logos (raster or SVG) that the page calls a logo, from its own domain', () => {
    const facts = extractBrandPage(`<header><a href="/"><img class="site-logo" src="/img/brand-logo.webp" alt="Lumora"></a>
      <img src="http://insecure.example/logo.png" alt="logo"><img src="/vector-logo.svg" alt="logo"><img src="/img/hero.jpg" alt="Summer campaign"></header>`, PAGE);
    expect(facts.logoCandidates.map(c => c.value)).toEqual(['https://www.lumora.example/img/brand-logo.webp', 'https://www.lumora.example/vector-logo.svg']);
  });

  it('strips markup and control characters from excerpts and values', () => {
    const facts = extractBrandPage('<meta property="og:site_name" content="Lu&#x6d;ora"><meta name="description" content="Care <b>for</b>\u0007 skin that is sensitive and dry.">', PAGE);
    expect(facts.names[0].value).toBe('Lumora');
    expect(facts.description?.value).toBe('Care for skin that is sensitive and dry.');
  });

  it('reduces a storefront site name to the brand name without dropping meaningful words', () => {
    expect(cleanSiteName('COSRX Official')).toBe('COSRX');
    expect(cleanSiteName('Lumora | Skincare for sensitive skin')).toBe('Lumora');
    expect(cleanSiteName('Lumora - Online Store')).toBe('Lumora');
    expect(cleanSiteName('The Ordinary')).toBe('The Ordinary');
    expect(cleanSiteName('Official')).toBe('Official');
  });

  it('never takes a payment, social or partner mark, or an image from another site, as the brand logo', () => {
    const facts = extractBrandPage(`<header><img src="https://upload.wikimedia.org/wikipedia/commons/Apple_Pay_logo.png" alt="Apple Pay">
      <img src="https://www.lumora.example/img/visa-logo.png" alt="Visa logo"><img src="https://cdn.other.example/lumora-logo.png" alt="logo">
      <img class="logo" src="https://www.lumora.example/img/lumora-logo.png" alt="Lumora"></header>`, PAGE);
    expect(facts.logoCandidates.map(c => c.value)).toEqual(['https://www.lumora.example/img/lumora-logo.png']);
  });
});
