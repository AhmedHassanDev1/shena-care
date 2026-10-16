import Link from 'next/link'
import {
  FileText, Heart, HelpCircle, History,
  Home, LogOut, PackageOpen, Printer, Route, ScanLine,
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
      { id: 'attention', label: 'نظرة عامة', icon: Home, href: '/admin' },
      { id: 'orders', label: 'الطلبات', icon: ShoppingBag, href: '/admin/orders' },
      { id: 'sourcing', label: 'الموردين والشراء', icon: Store, href: '/admin/sourcing' },
      { id: 'hub', label: 'المخزن والتجهيز', icon: PackageOpen, href: '/hub' },
      { id: 'dispatch', label: 'التوصيل والمندوبين', icon: Truck, href: '/hub/dispatch' },
      { id: 'cod', label: 'المالية والتحصيل', icon: Wallet, href: '/admin/cash' },
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
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-[#ff783d]/15 text-[#ff783d] ring-1 ring-[#ff783d]/30 shadow-sm">
        <Heart className="size-4 fill-[#ff783d] text-[#ff783d]" />
      </div>
      <div className="flex flex-col">
        <span className={cn('font-bw-display text-base font-bold tracking-tight', onKohl ? 'text-bw-on-kohl' : 'text-bw-ink')}>
          شينا
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-bw-ink-subtle">
          SHINACARE
        </span>
      </div>
    </div>
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
                'group flex h-bw-control shrink-0 items-center gap-3 rounded-bw-field border px-3 text-bw-small transition-all duration-200',
                item.id === active
                  ? 'border-s-2 border-bw-action border-y-transparent border-e-transparent bg-gradient-to-l from-transparent via-[#ff783d]/10 to-[#ff783d]/20 font-semibold text-[#ff783d] shadow-[inset_3px_0_12px_rgba(255,120,61,0.15)]'
                  : 'border-transparent text-bw-ink-soft hover:bg-white/[0.04] hover:text-bw-ink',
              )}
            >
              <item.icon className={cn('size-4 transition-transform duration-200 group-hover:scale-105', item.id === active ? 'text-[#ff783d] drop-shadow-[0_0_8px_rgba(255,120,61,0.6)]' : 'text-bw-ink-subtle group-hover:text-bw-ink')} aria-hidden />
              <span className="flex-1">{item.label}</span>
              <Count value={counts?.[item.id]} />
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-bw-line p-3 space-y-2">
          <button type="button" className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-bw-small text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink transition-colors">
            <HelpCircle className="size-4 text-bw-ink-subtle" aria-hidden />
            <span>مركز المساعدة</span>
          </button>
          <div className="flex items-center justify-between gap-2 rounded-lg bg-bw-sunken/60 p-2.5 text-bw-small text-bw-ink-soft">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#ff783d]/20 text-[11px] font-bold text-[#ff783d]">
                {operator.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-bw-ink truncate text-[12px]">{operator}</p>
                <p className="text-[10px] text-bw-ink-subtle truncate">مدير النظام</p>
              </div>
            </div>
            {logout}
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
