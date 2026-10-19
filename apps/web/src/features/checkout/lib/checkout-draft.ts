import type { LocationPin } from '../components/DeliveryLocationPicker';

export type Governorate = 'Cairo' | 'Giza';

export interface NewAddressDraft {
  label: string;
  governorate: Governorate | '';
  area: string;
  shippingAddress: string;
  notes: string;
  pin: LocationPin | null;
}

/**
 * What the customer entered on checkout, kept as a client-side draft (Addendum §Checkout interruption: "Checkout
 * progress entered before sign-in … kept as a client-side draft and restored; prices and the delivery fee are
 * recalculated by the server"). This tab only (sessionStorage): it survives the sign-in round trip and a refresh,
 * never another device or a closed browser, and is cleared when the order is placed. No prices are stored.
 */
export interface CheckoutDraft {
  recipient?: { name: string; phone: string };
  addressId?: string | 'new' | null;
  newAddress?: NewAddressDraft;
  couponCode?: string;
}

const DRAFT_KEY = 'shena.checkoutDraft';
const PLACED_KEY = 'shena.placedOrder';

export const EMPTY_ADDRESS: NewAddressDraft = { label: '', governorate: '', area: '', shippingAddress: '', notes: '', pin: null };

export function readDraft(): CheckoutDraft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as CheckoutDraft) : {};
  } catch {
    return {};
  }
}

export function saveDraft(draft: CheckoutDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // The draft is a convenience; checkout works without it.
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * The order this checkout just created (handoff §Screen inventory, impl.): Back must not return to a submittable
 * checkout, and landing on checkout again resumes that order instead of creating a new one.
 */
export function rememberPlacedOrder(orderNumber: string): void {
  try {
    sessionStorage.setItem(PLACED_KEY, orderNumber);
  } catch {
    // Without storage, an empty cart still keeps checkout from submitting anything.
  }
}

export function placedOrder(): string | null {
  try {
    return sessionStorage.getItem(PLACED_KEY);
  } catch {
    return null;
  }
}

export function forgetPlacedOrder(): void {
  try {
    sessionStorage.removeItem(PLACED_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Egyptian mobile as the API validates it (ordering CheckoutDto: ^(\+201|01)[0-9]{9}$), after digit normalisation. */
export const EGYPT_MOBILE = /^(\+201|01)[0-9]{9}$/;

/** «القاهرة» / "Cairo" etc. → the governorate value the API accepts. */
export function toGovernorate(value: string | null | undefined): Governorate | '' {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'cairo' || v === 'القاهرة') return 'Cairo';
  if (v === 'giza' || v === 'الجيزة') return 'Giza';
  return '';
}
