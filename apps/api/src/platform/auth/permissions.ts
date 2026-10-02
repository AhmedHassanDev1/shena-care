import { Role } from '@prisma/client';

export const PERMISSIONS = [
  'catalog.read', 'catalog.manage',
  'pricing.read', 'pricing.manage',
  'supplier.read', 'supplier.manage',
  'supplier_offer.read', 'supplier_offer.manage',
  'order.read', 'order.manage',
  'sourcing.read', 'sourcing.manage',
  'hub.receive', 'hub.prepare', 'hub.pack', 'hub.dispatch',
  'inventory.read', 'inventory.adjust',
  'delivery.plan', 'delivery.handoff', 'delivery.complete',
  'cod.read', 'cod.reconcile',
  'return.read', 'return.manage',
  'support.read', 'support.manage',
  'ai_review.read', 'ai_review.approve',
  'dashboard.read'
] as const;

export type Permission = typeof PERMISSIONS[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  CUSTOMER: [], // Customers have no central admin permissions, they operate purely on object-ownership rules.
  ADMIN: [...PERMISSIONS], // Admin has all 30 permissions
  HUB_OPERATOR: [
    'order.read', 'sourcing.read', 'sourcing.manage',
    'hub.receive', 'hub.prepare', 'hub.pack', 'hub.dispatch',
    'inventory.read', 'inventory.adjust',
    'delivery.plan', 'delivery.handoff', 'delivery.complete',
    'cod.read', 'cod.reconcile',
    'return.read', 'return.manage',
    'support.read', 'support.manage',
    'dashboard.read'
  ],
  SUPPLIER: [
    'supplier_offer.read', 'supplier_offer.manage',
    'order.read', // limited by ownership
    'sourcing.read' // limited by PO ownership
  ],
  DRIVER: [
    'delivery.plan', 'delivery.handoff', 'delivery.complete',
    'cod.read', 'cod.reconcile'
  ]
};
