require('dotenv').config();
const https = require('https');

async function testExa() {
  const apiKey = process.env.EXA_API_KEY;
  if (!apiKey) return { status: 'MISSING_KEY' };

  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: 'CeraVe Moisturizing Cream official site',
        numResults: 2,
      }),
    });
    if (!res.ok) {
      return { status: 'HTTP_ERROR', statusCode: res.status, text: (await res.text()).slice(0, 200) };
    }
    const data = await res.json();
    return { status: 'SUCCESS', count: data.results?.length ?? 0, sample: data.results?.[0]?.url };
  } catch (e) {
    return { status: 'FETCH_ERROR', message: e.message };
  }
}

async function testFirecrawl() {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return { status: 'MISSING_KEY' };

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://example.com',
        formats: ['markdown'],
      }),
    });
    if (!res.ok) {
      return { status: 'HTTP_ERROR', statusCode: res.status, text: (await res.text()).slice(0, 200) };
    }
    const data = await res.json();
    return { status: 'SUCCESS', hasMarkdown: Boolean(data.data?.markdown) };
  } catch (e) {
    return { status: 'FETCH_ERROR', message: e.message };
  }
}

async function testGrok() {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) return { status: 'MISSING_KEY' };

  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'grok-2-latest',
        messages: [
          { role: 'system', content: 'Respond with valid JSON.' },
          { role: 'user', content: 'Return {"status": "ok", "provider": "grok"}' },
        ],
        temperature: 0.1,
      }),
    });
    if (!res.ok) {
      return { status: 'HTTP_ERROR', statusCode: res.status, text: (await res.text()).slice(0, 200) };
    }
    const data = await res.json();
    return { status: 'SUCCESS', reply: data.choices?.[0]?.message?.content };
  } catch (e) {
    return { status: 'FETCH_ERROR', message: e.message };
  }
}

async function main() {
  console.log('Testing Exa API...');
  console.log('Exa:', await testExa());

  console.log('Testing Firecrawl API...');
  console.log('Firecrawl:', await testFirecrawl());

  console.log('Testing Grok API...');
  console.log('Grok:', await testGrok());
}

main();
