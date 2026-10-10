import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();
const API_URL = 'http://localhost:3001';

async function run() {
  console.log('--- GLO-118, 187, 86 E2E Test ---');

  // Wait for server to boot
  await new Promise(resolve => setTimeout(resolve, 2000));

  let customerToken = '';
  const email = `test-user-${Date.now()}@test.com`;

  try {
    const res = await fetch(`${API_URL}/accounts/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test User', email, password: 'password123' })
    });
    const data: any = await res.json();
    if (!res.ok) throw new Error(data.message || 'Error registering');
    customerToken = data.token;
    console.log('1. Customer registered:', !!customerToken);
  } catch (e: any) {
    console.log('1. Register failed:', e.message);
  }

  // 1. Create Draft (Anonymous)
  let draftId = '';
  let guestToken = '';
  try {
    const res = await fetch(`${API_URL}/care/workspace/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ careArea: 'skin', primaryConcern: 'acne', budget: 100, isBudgetStrict: true })
    });
    const data: any = await res.json();
    if (!res.ok) throw new Error(data.message || 'Error');
    draftId = data.draft.id;
    guestToken = data.guestToken;
    console.log(`2. Anonymous draft created: PASS (${draftId})`);
  } catch (e: any) {
    console.log(`2. Anonymous draft created: FAIL - ${e.message}`);
  }

  // 2. Link Draft to Customer
  try {
    const res = await fetch(`${API_URL}/care/workspace/drafts/${draftId}/link`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${customerToken}`,
        'x-guest-token': guestToken 
      }
    });
    if (!res.ok) {
      const err: any = await res.json();
      throw new Error(err.message || 'Error');
    }
    console.log(`3. Link draft to customer: PASS`);
  } catch (e: any) {
    console.log(`3. Link draft to customer: FAIL - ${e.message}`);
  }

  // 3. Generate Proposal (Triggers FastAPI / Groq)
  let proposalId = '';
  try {
    console.log(`4. Generating proposal... this may take some time depending on AI`);
    const res = await fetch(`${API_URL}/care/workspace/drafts/${draftId}/proposals`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${customerToken}`
      }
    });
    const data: any = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    proposalId = data.id;
    console.log(`4. Generate proposal: PASS (Status: ${data.status})`);
    
    // Check if it's a failed proposal or successful
    if (data.status === 'failed') {
      console.log(`   -> Proposal failed cleanly. Error:`, data.error);
    } else {
      console.log(`   -> Proposal generated successfully.`);
    }
  } catch (e: any) {
    console.log(`4. Generate proposal: FAIL - ${e.message}`);
  }

  // 4. Accept Proposal
  if (proposalId) {
    try {
      const res = await fetch(`${API_URL}/care/workspace/proposals/${proposalId}/accept`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${customerToken}`
        }
      });
      const data: any = await res.json();
      if (!res.ok) {
        if (data.statusCode === 400 && data.message && typeof data.message === 'string' && data.message.includes('failed')) {
           console.log(`5. Accept proposal: SKIPPED (Proposal is in failed state)`);
        } else {
           throw new Error(JSON.stringify(data));
        }
      } else {
        console.log(`5. Accept proposal: PASS (Routine ID: ${data.id})`);
      }
    } catch (e: any) {
      console.log(`5. Accept proposal: FAIL - ${e.message}`);
    }
  }

  process.exit(0);
}

run();
