import { apiClient } from './api-client';

jest.mock('./config', () => ({ requireApiUrl: () => 'http://localhost:3001' }));

describe('apiClient request headers', () => {
  const originalFetch = global.fetch;

  afterEach(() => { global.fetch = originalFetch; });

  it('does not request a JSON preflight for a bodyless public GET', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [] }) });
    global.fetch = fetchMock as typeof fetch;

    await apiClient.get('/products/discovery?limit=8');

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/products/discovery?limit=8',
      expect.objectContaining({ method: 'GET', headers: {} }));
  });

  it('keeps JSON content type for requests with a body', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    global.fetch = fetchMock as typeof fetch;

    await apiClient.post('/ordering/cart/add', { skuId: 'sku', quantity: 1 });

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/ordering/cart/add',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }));
  });
});
