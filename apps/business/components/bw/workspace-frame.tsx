import Link from 'next/link'
import {
  Banknote, ClipboardCheck, FileText, Gauge, History, LogOut, PackageOpen, Printer, Route, ScanLine,
  ShoppingBag, Store, Truck, UserRound, Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * One navigation vocabulary for all four roles (GLO-230, wired in C0). Each role sees only its own
 * sections; this is presentation only — the API's role guards and object ownership remain the
 * security boundary.
 *   desktop → admin operator and hub desk: sidebar on the inline-start edge
 *   mobile  → supplier, driver: compact top bar + bottom tabs (52px touch targets)
 *   task    → hub scanner station: kohl bar with the task name and an explicit exit, no other navigation
 */

export type Role = 'admin' | 'supplier' | 'hub' | 'driver'

type NavItem = { id: string; label: string; icon: React.ElementType; href: string }

const roleNav: Record<Role, { title: string; items: NavItem[] }> = {
  admin: {
    title: 'الإدارة',
    items: [
      { id: 'attention', label: 'محتاج تدخل', icon: Gauge, href: '/admin' },
      { id: 'orders', label: 'الطلبات', icon: ShoppingBag, href: '/admin/orders' },
      { id: 'sourcing', label: 'الموردين وأوامر الشراء', icon: Store, href: '/admin/sourcing' },
      { id: 'cod', label: 'التحصيل والتسويات', icon: Banknote, href: '/admin/cash' },
    ],
  },
  supplier: {
    title: 'بوابة المورد',
    items: [
      { id: 'pos', label: 'أوامر الشراء', icon: FileText, href: '/supplier' },
      { id: 'account', label: 'حسابي', icon: UserRound, href: '/supplier/account' },
    ],
  },
  hub: {
    title: 'المخزن',
    items: [
      { id: 'receive', label: 'الاستلام', icon: PackageOpen, href: '/hub/receive' },
      { id: 'pick', label: 'التجهيز', icon: ScanLine, href: '/hub/prepare' },
      { id: 'pack', label: 'التغليف والطباعة', icon: Printer, href: '/hub/pack' },
      { id: 'handoff', label: 'التسليم للمندوب', icon: Truck, href: '/hub/dispatch' },
      { id: 'cash', label: 'عدّ النقدية', icon: Wallet, href: '/hub/cash' },
    ],
  },
  driver: {
    title: 'المندوب',
    items: [
      { id: 'run', label: 'مشواري', icon: Route, href: '/driver' },
      { id: 'history', label: 'السجل', icon: History, href: '/driver/history' },
      { id: 'account', label: 'حسابي', icon: UserRound, href: '/driver/profile' },
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

function Count({ value }: { value?: number }) {
  if (!value) return null
  return (
    <span className="rounded-full bg-bw-danger px-2 text-bw-small font-semibold text-bw-on-action">
      <bdi className="bw-code">{value}</bdi>
    </span>
  )
}

export function WorkspaceFrame({
  role,
  active,
  mode,
  operator,
  task,
  counts,
  exitHref = '/hub',
  onLogout,
  children,
}: {
  role: Role
  active: string
  mode: 'desktop' | 'mobile' | 'task'
  operator: string
  task?: string
  /** Live counts from the API per nav id; never shown when absent. */
  counts?: Record<string, number | undefined>
  exitHref?: string
  onLogout?: () => void
  children: React.ReactNode
}) {
  const nav = roleNav[role]
  const logout = onLogout ? (
    <button type="button" onClick={onLogout} className="inline-flex items-center gap-1 text-bw-small text-bw-ink-soft hover:text-bw-ink">
      <LogOut className="size-4" aria-hidden />
      خروج
    </button>
  ) : null

  if (mode === 'task') {
    return (
      <div className="bw-kohl flex min-h-dvh flex-col bg-bw-kohl text-bw-on-kohl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-bw-line px-4 py-3">
          <div className="flex items-center gap-3">
            <Wordmark onKohl />
            <span className="text-bw-small text-bw-on-kohl-soft">
              {nav.title} · {task}
            </span>
          </div>
          <div className="flex items-center gap-3 text-bw-small text-bw-on-kohl-soft">
            <span>{operator}</span>
            <Link href={exitHref} className="inline-flex h-bw-control items-center gap-2 rounded-bw-field border border-bw-line-field px-4 text-bw-on-kohl hover:bg-bw-kohl-raised">
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
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-bw-page ring-1 ring-bw-line">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-bw-line bg-bw-surface/95 px-4 py-3 backdrop-blur-sm">
          <Wordmark />
          <span className="flex items-center gap-3 text-bw-small text-bw-ink-soft">
            <span>
              {nav.title} · {operator}
            </span>
            {logout}
          </span>
        </header>
        <main className="flex-1 pb-4">{children}</main>
        <nav aria-label={nav.title} className="sticky bottom-0 z-10 grid grid-flow-col border-t border-bw-line bg-bw-surface/95 backdrop-blur-sm">
          {nav.items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              aria-current={item.id === active ? 'page' : undefined}
              className={cn(
                'flex h-bw-touch flex-col items-center justify-center border-t-2 text-bw-small',
                item.id === active ? 'border-bw-action bg-bw-action-soft font-semibold text-bw-action-ink' : 'border-transparent text-bw-ink-soft hover:text-bw-ink',
              )}
            >
              <item.icon className="size-5" aria-hidden />
              <span className="flex items-center gap-1">
                {item.label}
                <Count value={counts?.[item.id]} />
              </span>
            </Link>
          ))}
        </nav>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bw-page lg:flex-row">
      <aside className="border-b border-bw-line bg-bw-kohl lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-e">
        <div className="flex items-center justify-between border-b border-bw-line px-4 py-5">
          <Wordmark />
        </div>
        <div className="hidden px-5 pb-2 pt-6 text-bw-small font-semibold text-bw-ink-subtle lg:block">{nav.title}</div>
        <nav aria-label={nav.title} className="flex gap-1 overflow-x-auto px-2 py-2 lg:flex-1 lg:flex-col lg:overflow-visible lg:px-3">
          {nav.items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              aria-current={item.id === active ? 'page' : undefined}
              className={cn(
                'flex h-bw-control shrink-0 items-center gap-3 rounded-bw-field border border-transparent px-3 text-bw-small',
                item.id === active ? 'border-bw-action/40 bg-bw-action-soft font-semibold text-bw-action-ink' : 'text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink',
              )}
            >
              <item.icon className="size-4" aria-hidden />
              <span className="flex-1">{item.label}</span>
              <Count value={counts?.[item.id]} />
            </Link>
          ))}
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-bw-line px-4 py-4 text-bw-small text-bw-ink-soft">
          <span className="flex items-center gap-2">
            <ClipboardCheck className="size-4" aria-hidden />
            {operator}
          </span>
          {logout}
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
