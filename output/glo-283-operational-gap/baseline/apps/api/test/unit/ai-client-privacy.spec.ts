import { HttpAiClient } from '../../src/platform/ai/http-ai.client';
import { GuidanceRecommendationRequest } from '../../src/platform/ai/ai-client.contract';

const CUSTOMER_ID = '343f1cb1-0b53-4876-90e8-07e1bf1f8d42';
const GUIDANCE_OK = { schemaVersion: '1', type: 'answer', message: 'ok', proposal: null };

function guidanceRequest(overrides: Partial<GuidanceRecommendationRequest> = {}): GuidanceRecommendationRequest {
  return {
    customerId: CUSTOMER_ID,
    profile: { skinType: 'oily', sensitivities: null, concerns: ['acne'] },
    chatHistory: [{ role: 'user', content: 'عندي حبوب' }],
    routineDraft: {
      id: 'b1e3c2a0-0000-4000-8000-000000000001',
      customerId: CUSTOMER_ID,
      guestTokenHash: 'f'.repeat(64),
      careArea: 'skin',
      primaryConcern: 'acne',
      secondaryGoals: ['dark-spots'],
      budget: { toString: () => '450.00' },
      isBudgetStrict: true,
      maxSteps: 4,
      ownedProductIds: ['p-1'],
      version: 3,
    },
    ...overrides,
  };
}

describe('HttpAiClient — service token and what the model sees of a customer', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockImplementation(async () => new Response(JSON.stringify(GUIDANCE_OK), { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const sent = (call = 0) => {
    const [url, init] = fetchMock.mock.calls[call];
    return { url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(init.body) };
  };

  it('sends the service token as a bearer header on every AI call', async () => {
    const client = new HttpAiClient('http://ai:8000', 1000, 'secret-token', 'pseudonym-key');
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(GUIDANCE_OK), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: '1', suggestions: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: '1', content: {} }), { status: 200 }));

    await client.recommendRoutine(guidanceRequest());
    await client.enrichProduct({ candidateRef: 'c-1', sourceType: 'supplier_feed', rawTitle: 'Gel' });
    await client.generateContent({ candidateId: 'c-1', facts: {} });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) expect(sent(i).headers.Authorization).toBe('Bearer secret-token');
  });

  it('sends no Authorization header when no token is configured', async () => {
    const client = new HttpAiClient('http://ai:8000', 1000, undefined, 'pseudonym-key');
    await client.recommendRoutine(guidanceRequest());
    expect(sent().headers.Authorization).toBeUndefined();
  });

  it('replaces the customer id with a keyed pseudonym the model cannot reverse', async () => {
    const client = new HttpAiClient('http://ai:8000', 1000, 'secret-token', 'pseudonym-key');
    await client.recommendRoutine(guidanceRequest());
    await client.recommendRoutine(guidanceRequest());
    await client.recommendRoutine(guidanceRequest({ customerId: 'guest-b1e3c2a0-0000-4000-8000-000000000001' }));

    const first = sent(0).body.customerId;
    expect(first).toMatch(/^subj_[0-9a-f]{32}$/);
    expect(sent(1).body.customerId).toBe(first); // stable for log correlation
    expect(sent(2).body.customerId).not.toBe(first);
    for (let i = 0; i < 3; i++) {
      const raw = JSON.stringify(sent(i).body);
      expect(raw).not.toContain(CUSTOMER_ID);
      expect(raw).not.toContain('b1e3c2a0-0000-4000-8000-000000000001');
    }
  });

  it('gives a different pseudonym under a different key', async () => {
    await new HttpAiClient('http://ai:8000', 1000, 't', 'key-a').recommendRoutine(guidanceRequest());
    await new HttpAiClient('http://ai:8000', 1000, 't', 'key-b').recommendRoutine(guidanceRequest());
    expect(sent(0).body.customerId).not.toBe(sent(1).body.customerId);
  });

  it('sends only the draft fields that shape a routine', async () => {
    const client = new HttpAiClient('http://ai:8000', 1000, 'secret-token', 'pseudonym-key');
    await client.recommendRoutine(guidanceRequest());

    expect(sent().body.routineDraft).toEqual({
      careArea: 'skin',
      primaryConcern: 'acne',
      secondaryGoals: ['dark-spots'],
      budget: 450,
      isBudgetStrict: true,
      maxSteps: 4,
    });
    expect(JSON.stringify(sent().body)).not.toContain('f'.repeat(64));
  });

  it('keeps the routine-shaping context the model needs', async () => {
    const client = new HttpAiClient('http://ai:8000', 1000, 'secret-token', 'pseudonym-key');
    await client.recommendRoutine(guidanceRequest({ routineDraft: null }));

    const body = sent().body;
    expect(body.profile).toEqual({ skinType: 'oily', sensitivities: null, concerns: ['acne'] });
    expect(body.chatHistory).toEqual([{ role: 'user', content: 'عندي حبوب' }]);
    expect(body.routineDraft).toBeNull();
    expect(Object.keys(body).sort()).toEqual(['catalogProducts', 'chatHistory', 'customerId', 'profile', 'routineDraft']);
  });

  it('keeps the customer id out of the schema-mismatch error the caller may store', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: '2' }), { status: 200 }));
    const client = new HttpAiClient('http://ai:8000', 1000, 'secret-token', 'pseudonym-key');
    await expect(client.recommendRoutine(guidanceRequest(), 'corr-1')).rejects.toThrow('(correlation corr-1)');
    await expect(
      (async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: '2' }), { status: 200 }));
        await client.recommendRoutine(guidanceRequest(), 'corr-2');
      })(),
    ).rejects.not.toThrow(CUSTOMER_ID);
  });
});
