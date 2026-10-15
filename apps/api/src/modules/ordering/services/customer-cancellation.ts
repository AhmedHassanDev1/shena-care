/**
 * Customer self-cancellation (C0 W6). A customer may cancel on their own only while nothing physical has
 * happened: the order is still being sourced and no goods are at the hub or in a parcel. Afterwards the
 * request goes to support, where staff use the audited cancellation (GLO-240) or the return flow.
 */
export function customerMayCancel(input: { orderStatus: string; shipmentStatus: string | null; receivedUnits: number }): boolean {
  return ['placed', 'confirmed'].includes(input.orderStatus) && input.receivedUnits === 0 &&
    (input.shipmentStatus === null || input.shipmentStatus === 'pending');
}
