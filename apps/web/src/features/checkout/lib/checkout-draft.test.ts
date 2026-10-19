import type { CartItem } from '@/lib/cart';
import { markPricesReviewed, needsPriceReview, pendingChanges } from '@/features/cart/lib/cart-review';
import { EGYPT_MOBILE, clearDraft, readDraft, saveDraft, toGovernorate } from './checkout-draft';

// The jest environment is node: a minimal in-memory sessionStorage for the draft and review helpers.
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

const line = (overrides: Partial<CartItem>): CartItem =>
  ({
    skuId: 'sku-1',
    quantity: 1,
    canOrder: true,
    priceAtAdd: 100,
    priceChangedSinceAdd: false,
    price: { amount: 100, currency: 'EGP' },
    subtotal: 100,
    sku: {} as CartItem['sku'],
    ...overrides,
  }) as CartItem;

describe('toGovernorate', () => {
  it('maps the Arabic and English names to the values the API accepts', () => {
    expect(toGovernorate('القاهرة')).toBe('Cairo');
    expect(toGovernorate(' cairo ')).toBe('Cairo');
    expect(toGovernorate('الجيزة')).toBe('Giza');
    expect(toGovernorate('Alexandria')).toBe('');
    expect(toGovernorate(null)).toBe('');
  });
});

describe('EGYPT_MOBILE', () => {
  it('matches the API pattern', () => {
    expect(EGYPT_MOBILE.test('01012345678')).toBe(true);
    expect(EGYPT_MOBILE.test('+201012345678')).toBe(true);
    expect(EGYPT_MOBILE.test('0101234567')).toBe(false);
    expect(EGYPT_MOBILE.test('02012345678')).toBe(false);
  });
});

describe('checkout draft', () => {
  afterEach(() => clearDraft());

  it('keeps what the customer entered, and nothing after it is cleared', () => {
    saveDraft({ recipient: { name: 'منة', phone: '01012345678' }, addressId: 'a1', couponCode: 'SAVE' });
    expect(readDraft()).toEqual({ recipient: { name: 'منة', phone: '01012345678' }, addressId: 'a1', couponCode: 'SAVE' });
    clearDraft();
    expect(readDraft()).toEqual({});
  });
});

describe('cart review before checkout', () => {
  beforeEach(() => sessionStorage.clear());

  it('asks once for a changed price and always for an unavailable product', () => {
    const changed = line({ skuId: 'a', priceChangedSinceAdd: true, priceAtAdd: 750, price: { amount: 780, currency: 'EGP' } });
    const gone = line({ skuId: 'b', canOrder: false });
    const fine = line({ skuId: 'c' });
    let reviewed = new Set<string>();
    expect(pendingChanges([changed, gone, fine], reviewed)).toMatchObject({ count: 2 });

    reviewed = markPricesReviewed([changed]);
    expect(needsPriceReview(changed, reviewed)).toBe(false);
    expect(pendingChanges([changed, gone, fine], reviewed)).toMatchObject({ count: 1 });

    // The same line at yet another price is a new change.
    expect(needsPriceReview({ ...changed, price: { amount: 800, currency: 'EGP' } }, reviewed)).toBe(true);
  });
});
