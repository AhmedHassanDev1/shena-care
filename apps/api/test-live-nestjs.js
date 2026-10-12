const fetch = require('node-fetch');

async function runLiveTest() {
  const baseUrl = 'http://localhost:3001';
  
  console.log('Registering test customer...');
  const regRes = await fetch(`${baseUrl}/accounts/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `test-live-${Date.now()}@example.com`,
      password: 'password123',
      name: 'Live Test Customer'
    })
  });
  const regData = await regRes.json();
  const token = regData.token;
  
  console.log('Fetching customer ID...');
  const meRes = await fetch(`${baseUrl}/accounts/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const meData = await meRes.json();
  const customerId = meData.id;
  
  console.log('Creating Care Profile...');
  await fetch(`${baseUrl}/care/profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ customerId, skinType: 'oily' })
  });
  
  console.log('Creating Guidance Session...');
  const sessionRes = await fetch(`${baseUrl}/guidance/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ customerId })
  });
  const sessionData = await sessionRes.json();
  const sessionId = sessionData.id;
  
  console.log('Sending message to Assistant...');
  const msgRes = await fetch(`${baseUrl}/guidance/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ content: 'I need an acne-fighting routine. Please propose a complete routine using the available catalog products.' })
  });
  
  const msgData = await msgRes.json();
  console.log('\n--- AI RESPONSE ---');
  console.dir(msgData, { depth: null });
  console.log('-------------------\n');
}

runLiveTest().catch(console.error);
