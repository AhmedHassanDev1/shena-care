/**
 * Guest → account adoption contract (GLO-70D).
 *
 * Emitted by AccountsService after a successful phone OTP verification when the
 * client supplied the `guestId` of an anonymous browsing session.
 *
 * Consumer rules (Cart GLO-71, RoutineDraft, ...):
 * - `guestId` is a client-generated UUID; it is a *bearer reference* only and must
 *   be treated as untrusted. Only guest-owned records keyed by this id may be adopted.
 * - Adoption MUST be idempotent per (customerId, guestId): handling the same event
 *   twice must not duplicate customer state or items.
 * - Adoption must happen inside a transaction and must never move data that already
 *   belongs to a different customer.
 * - An order number alone never proves ownership.
 */
export const CUSTOMER_VERIFIED_EVENT = 'customer.verified';
/** Emitted after every successful phone OTP verification (C0 W6): the account controls this number. */
export const CUSTOMER_PHONE_VERIFIED_EVENT = 'customer.phone_verified';

export interface CustomerPhoneVerifiedEvent {
  customerId: string;
  /** Canonical +20 form. */
  phoneNumber: string;
}

export interface CustomerVerifiedEvent {
  customerId: string;
  guestId: string;
}
