'use client'

import { HubShell } from '@/components/workspace/hub'
import { PreparationDesk } from '@/components/workspace/prep/workspace'

/**
 * Orders & Preparation (GLO-315): the one primary Hub screen. Pick an order, then one step at a time: verify the products by scan,
 * choose the packaging, print, hand off. All state comes from the Hub desk API; nothing here decides a business rule.
 */
export default function HubOrders() {
  return <HubShell active="orders"><PreparationDesk /></HubShell>
}
