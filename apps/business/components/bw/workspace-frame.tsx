import Link from 'next/link'
import {
  FileText, Heart, HelpCircle, History,
  Home, LogOut, PackageOpen, Printer, Route, ScanLine, Search,
  ShieldAlert, ShoppingBag, Store, Truck, UserRound, Wallet,
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
      { id: 'hub', label: 'المخزن والتجهيز', icon: PackageOpen, href: '/admin/hub' },
      { id: 'delivery', label: 'عمليات التوصيل', icon: Truck, href: '/admin/delivery' },
      { id: 'exceptions', label: 'مركز الاستثناءات', icon: ShieldAlert, href: '/admin/exceptions' },
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
    <div className="flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#34d27b]/25 to-[#34d27b]/10 text-[#34d27b] ring-1 ring-[#34d27b]/35 shadow-[0_0_12px_rgba(52,210,123,0.25)]">
        <Heart className="size-4.5 fill-[#34d27b] text-[#34d27b]" />
      </div>
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <span className={cn('font-bw-display text-base font-extrabold tracking-tight', onKohl ? 'text-bw-on-kohl' : 'text-bw-ink')}>
            ShinaCare
          </span>
          <span className="text-[10px] font-bold text-[#34d27b] bg-[#34d27b]/15 px-1.5 py-0.2 rounded-full border border-[#34d27b]/25">
            أعمال
          </span>
        </div>
        <span className="text-[10px] text-bw-ink-subtle">
          لوحة العمليات الموحدة
        </span>
      </div>
    </div>
  )
}

function Count({ value }: { value?: number }) {
  if (!value) return null
  return (
    <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
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
      <aside className="border-b border-white/[0.06] bg-[#090b0e] lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-e lg:border-white/[0.06]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4.5">
          <Wordmark />
        </div>

        {/* Dedicated Sidebar Search (Echoing SevenTeen reference) */}
        <div className="hidden lg:block px-3 pt-3 pb-1">
          <div className="relative">
            <Search className="absolute start-3 top-2.5 size-3.5 text-bw-ink-subtle pointer-events-none" />
            <input
              type="text"
              placeholder="البحث في النظام..."
              className="h-8.5 w-full rounded-xl border border-white/[0.06] bg-bw-surface/70 ps-8.5 pe-3 text-xs text-bw-ink placeholder:text-bw-ink-subtle focus:border-[#ff783d] focus:outline-none focus:ring-1 focus:ring-[#ff783d]/30 transition-all shadow-inner"
            />
          </div>
        </div>

        <div className="hidden px-4 pb-1 pt-4 text-[10px] font-bold uppercase tracking-wider text-bw-ink-subtle lg:block">
          {nav.title}
        </div>
        <nav aria-label={nav.title} className="flex gap-1 overflow-x-auto px-2 py-2 lg:flex-1 lg:flex-col lg:overflow-visible lg:px-3">
          {nav.items.map((item) => {
            const isActive = item.id === active
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group flex h-9.5 shrink-0 items-center gap-2.5 rounded-xl border px-3 text-xs transition-all duration-200',
                  isActive
                    ? 'border-white/[0.08] bg-bw-surface text-bw-ink font-semibold shadow-[0_2px_12px_rgba(0,0,0,0.4)]'
                    : 'border-transparent text-bw-ink-soft hover:bg-white/[0.03] hover:text-bw-ink',
                )}
              >
                <item.icon className={cn('size-4 transition-transform duration-200 group-hover:scale-105', isActive ? 'text-[#34d27b] drop-shadow-[0_0_8px_rgba(52,210,123,0.6)]' : 'text-bw-ink-subtle group-hover:text-bw-ink')} aria-hidden />
                <span className="flex-1">{item.label}</span>
                {isActive ? (
                  <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] ms-1" />
                ) : null}
                <Count value={counts?.[item.id]} />
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto border-t border-white/[0.06] p-3 space-y-2">
          <button type="button" className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-xs text-bw-ink-soft hover:bg-white/[0.03] hover:text-bw-ink transition-colors">
            <HelpCircle className="size-4 text-bw-ink-subtle" aria-hidden />
            <span>مركز المساعدة والدعم</span>
          </button>
          <div className="flex items-center justify-between gap-2.5 rounded-xl border border-white/[0.06] bg-bw-surface/70 p-2.5 text-xs text-bw-ink-soft">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-7.5 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#34d27b]/25 to-[#34d27b]/10 text-xs font-bold text-[#34d27b] border border-[#34d27b]/30 shadow-xs">
                {operator.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-bw-ink truncate text-xs">{operator}</p>
                <p className="text-[10px] text-bw-ink-subtle truncate">مدير العمليات</p>
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
