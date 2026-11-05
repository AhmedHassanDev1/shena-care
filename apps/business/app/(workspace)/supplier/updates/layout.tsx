import { FrozenIntakeGate } from '@/components/workspace/frozen-intake-gate'

/** Supplier files and stock updates are frozen in BROADCAST_ON_DEMAND (GLO-285); the pages return with OFFER_BASED. */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <FrozenIntakeGate>{children}</FrozenIntakeGate>
}
