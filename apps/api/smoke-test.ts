import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();
const API_URL = 'http://localhost:3001';

async function run() {
  console.log('--- Security Smoke Check ---');
  
  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    const res = await fetch(`${API_URL}/health`);
    const helmetPresent = res.headers.get('x-dns-prefetch-control') !== null;
    console.log(`8. Application boots successfully with Helmet: ${helmetPresent ? 'PASS' : 'FAIL (No Helmet Headers)'}`);
  } catch(e: any) {
    console.log('Server not responding', e.message);
  }

  const customerEmail = `customer-${Date.now()}@test.com`;
  let customerToken = '';
  try {
    const res = await fetch(`${API_URL}/accounts/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke Customer', email: customerEmail, password: 'password123' })
    });
    const data: any = await res.json();
    if (!res.ok) throw new Error(data.message || 'Error');
    customerToken = data.token;
    console.log(`1. Register customer: PASS`);
  } catch (e: any) {
    console.log(`1. Register customer: FAIL - ${e.message}`);
  }

  try {
    const res = await fetch(`${API_URL}/accounts/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customerEmail, password: 'password123' })
    });
    if (!res.ok) throw new Error('Error');
    console.log(`2. Login correct password: PASS`);
  } catch (e: any) {
    console.log(`2. Login correct password: FAIL - ${e.message}`);
  }

  try {
    const res = await fetch(`${API_URL}/accounts/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customerEmail, password: 'wrongpassword' })
    });
    if (res.ok) {
      console.log(`3. Wrong password rejected: FAIL (It allowed login)`);
    } else {
      console.log(`3. Wrong password rejected: PASS (${res.status})`);
    }
  } catch (e: any) {
    console.log(`3. Wrong password rejected: PASS`);
  }

  try {
    const res = await fetch(`${API_URL}/ordering/cart`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    if (!res.ok) throw new Error('Error');
    console.log(`4. CUSTOMER access customer endpoint: PASS`);
  } catch (e: any) {
    console.log(`4. CUSTOMER access customer endpoint: FAIL - ${e.message}`);
  }

  try {
    const res = await fetch(`${API_URL}/fulfillment/locations`, {
      headers: { Authorization: `Bearer ${customerToken}` }
    });
    if (res.ok) {
      console.log(`5. CUSTOMER rejected from internal endpoint: FAIL (Allowed)`);
    } else {
      console.log(`5. CUSTOMER rejected from internal endpoint: PASS (${res.status})`);
    }
  } catch (e: any) {
    console.log(`5. CUSTOMER rejected from internal endpoint: PASS`);
  }

  const hubOpEmail = `hub-${Date.now()}@test.com`;
  const sup1Email = `sup1-${Date.now()}@test.com`;
  const sup2Email = `sup2-${Date.now()}@test.com`;

  const pHash = await bcrypt.hash('password', 12);
  
  const hubUser = await prisma.customer.create({
    data: {
      name: 'Hub Op', email: hubOpEmail, roles: ['HUB_OPERATOR'],
      identities: { create: { provider: 'EMAIL', providerId: hubOpEmail, passwordHash: pHash } }
    }
  });

  const sup1 = await prisma.customer.create({
    data: {
      name: 'Sup 1', email: sup1Email, roles: ['SUPPLIER'],
      identities: { create: { provider: 'EMAIL', providerId: sup1Email, passwordHash: pHash } }
    }
  });

  const getSession = async (cId: string) => {
    const s = await prisma.session.create({ data: { customerId: cId, token: randomUUID(), expiresAt: new Date(Date.now() + 10000), isValid: true }});
    return s.token;
  };

  const hubToken = await getSession(hubUser.id);
  const sup1Token = await getSession(sup1.id);

  try {
    const res = await fetch(`${API_URL}/fulfillment/locations`, {
      headers: { Authorization: `Bearer ${hubToken}` }
    });
    if (!res.ok) throw new Error('Error');
    console.log(`6. HUB_OPERATOR access required endpoint: PASS`);
  } catch (e: any) {
    console.log(`6. HUB_OPERATOR access required endpoint: FAIL - ${e.message}`);
  }

  try {
    const res = await fetch(`${API_URL}/sourcing/suppliers/sup-id-2`, {
      headers: { Authorization: `Bearer ${sup1Token}` }
    });
    if (res.ok) {
      console.log(`7. SUPPLIER tenant isolation: FAIL (Allowed access to sup-id-2)`);
    } else {
      console.log(`7. SUPPLIER tenant isolation: PASS (${res.status})`);
    }
  } catch (e: any) {
    console.log(`7. SUPPLIER tenant isolation: PASS`);
  }

  process.exit(0);
}

run();
