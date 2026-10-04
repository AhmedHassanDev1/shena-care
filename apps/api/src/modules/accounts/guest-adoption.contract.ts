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

export interface CustomerVerifiedEvent {
  customerId: string;
  guestId: string;
}
