import Link from 'next/link'
import {
  Banknote, Boxes, ClipboardCheck, FileText, Gauge, LogOut, PackageOpen, Printer, ReceiptText, Route, ScanLine,
  ShoppingBag, Store, Tags, Truck, UserRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * One navigation vocabulary for all four roles (GLO-230). Each role sees only its own sections;
 * this is presentation only — the API's role guards and object ownership remain the security boundary.
 *   desktop → admin operator: sidebar on the inline-start edge
 *   mobile  → supplier, driver: compact top bar + bottom tabs (52px touch targets)
 *   task    → hub scanner station: kohl bar with the task name and an explicit exit, no other navigation
 */

export type Role = 'admin' | 'supplier' | 'hub' | 'driver'

type NavItem = { id: string; label: string; icon: React.ElementType; count?: number }

const roleNav: Record<Role, { title: string; items: NavItem[] }> = {
  admin: {
    title: 'الإدارة',
    items: [
      { id: 'attention', label: 'محتاج تدخل', icon: Gauge, count: 7 },
      { id: 'orders', label: 'الطلبات', icon: ShoppingBag },
      { id: 'catalog', label: 'المنتجات والأسعار', icon: Tags },
      { id: 'sourcing', label: 'الموردين وأوامر الشراء', icon: Store },
      { id: 'hub', label: 'المخزن', icon: Boxes },
      { id: 'cod', label: 'التحصيل والتسويات', icon: Banknote },
    ],
  },
  supplier: {
    title: 'بوابة المورد',
    items: [
      { id: 'pos', label: 'أوامر الشراء', icon: FileText, count: 2 },
      { id: 'offers', label: 'عروضي', icon: Tags },
      { id: 'account', label: 'حسابي', icon: UserRound },
    ],
  },
  hub: {
    title: 'المخزن',
    items: [
      { id: 'receive', label: 'الاستلام', icon: PackageOpen },
      { id: 'pick', label: 'التجهيز', icon: ScanLine },
      { id: 'pack', label: 'التغليف والطباعة', icon: Printer },
      { id: 'handoff', label: 'التسليم للمندوب', icon: Truck },
    ],
  },
  driver: {
    title: 'المندوب',
    items: [
      { id: 'run', label: 'مشواري', icon: Route, count: 6 },
      { id: 'custody', label: 'عهدتي', icon: ReceiptText },
      { id: 'account', label: 'حسابي', icon: UserRound },
    ],
  },
}

function Wordmark({ onKohl }: { onKohl?: boolean }) {
  return (
    <span className={cn('font-bw-display text-bw-heading font-semibold', onKohl ? 'text-bw-on-kohl' : 'text-bw-ink')}>
      شينا كير
      <span className={cn('ms-2 text-bw-small font-normal', onKohl ? 'text-bw-on-kohl-soft' : 'text-bw-ink-soft')}>أعمال</span>
    </span>
  )
}

export function WorkspaceFrame({
  role,
  active,
  mode,
  operator,
  task,
  children,
}: {
  role: Role
  active: string
  mode: 'desktop' | 'mobile' | 'task'
  operator: string
  task?: string
  children: React.ReactNode
}) {
  const nav = roleNav[role]

  if (mode === 'task') {
    return (
      <div className="bw-kohl flex min-h-dvh flex-col bg-bw-kohl text-bw-on-kohl">
        <header className="flex items-center justify-between gap-3 border-b border-bw-kohl-raised px-4 py-3">
          <div className="flex items-center gap-3">
            <Wordmark onKohl />
            <span className="text-bw-small text-bw-on-kohl-soft">
              {nav.title} · {task}
            </span>
          </div>
          <div className="flex items-center gap-3 text-bw-small text-bw-on-kohl-soft">
            <span>{operator}</span>
            <Link href="/design" className="inline-flex h-bw-control items-center gap-2 rounded-full border-[1.5px] border-bw-on-kohl-soft px-4 text-bw-on-kohl">
              <LogOut className="size-4" aria-hidden />
              خروج من المهمة
            </Link>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    )
  }

  if (mode === 'mobile') {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-bw-page shadow-sm ring-1 ring-bw-line">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-bw-line bg-bw-surface px-4 py-3">
          <Wordmark />
          <span className="text-bw-small text-bw-ink-soft">
            {nav.title} · {operator}
          </span>
        </header>
        <main className="flex-1 pb-4">{children}</main>
        <nav aria-label={nav.title} className="sticky bottom-0 grid grid-flow-col border-t border-bw-line bg-bw-surface">
          {nav.items.map((item) => (
            <a
              key={item.id}
              href="#"
              aria-current={item.id === active ? 'page' : undefined}
              className={cn(
                'flex h-bw-touch flex-col items-center justify-center text-bw-small',
                item.id === active ? 'font-semibold text-bw-action-ink' : 'text-bw-ink-soft',
              )}
            >
              <item.icon className="size-5" aria-hidden />
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="border-b border-bw-line bg-bw-surface lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-e">
        <div className="flex items-center justify-between px-4 py-4">
          <Wordmark />
        </div>
        <nav aria-label={nav.title} className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible">
          {nav.items.map((item) => (
            <a
              key={item.id}
              href="#"
              aria-current={item.id === active ? 'page' : undefined}
              className={cn(
                'flex h-bw-control shrink-0 items-center gap-2 rounded-full px-3 text-bw-small',
                item.id === active ? 'bg-bw-action-soft font-semibold text-bw-action-ink' : 'text-bw-ink-soft hover:bg-bw-sunken',
              )}
            >
              <item.icon className="size-4" aria-hidden />
              <span className="flex-1">{item.label}</span>
              {item.count ? (
                <span className="rounded-full bg-bw-danger px-2 text-bw-small font-semibold text-bw-on-action">
                  <bdi className="bw-code">{item.count}</bdi>
                </span>
              ) : null}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 border-t border-bw-line px-4 py-3 text-bw-small text-bw-ink-soft lg:flex">
          <ClipboardCheck className="size-4" aria-hidden />
          {operator}
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
