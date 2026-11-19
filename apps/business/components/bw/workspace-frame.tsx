'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ClipboardList, Ellipsis, FileSpreadsheet, Heart, History, LayoutDashboard, ListChecks,
  LogOut, PackageOpen, Route, ScanLine,
  Radio, ShoppingBag, Settings2, Store, Truck, Undo2, UserRound, Users, Wallet,
} from 'lucide-react'
import { Dialog, useDialog } from '@/components/bw/primitives'
import { cn } from '@/lib/utils'

/*
 * One navigation vocabulary for all four roles (GLO-230, wired in C0). Each role sees only its own
 * sections; this is presentation only — the API's role guards and object ownership remain the
 * security boundary.
 *   desktop → admin operator and hub desk: sidebar on the inline-start edge
 *   mobile  → driver: compact top bar + bottom tabs (52px touch targets)
 *   responsive → supplier: desktop-first operational sidebar on lg, bottom 3-item navigation on mobile
 *   task    → hub scanner station: kohl bar with the task name and an explicit exit, no other navigation
 */

export type Role = 'admin' | 'supplier' | 'hub' | 'driver'
export type WorkspaceMode = 'desktop' | 'mobile' | 'task' | 'responsive'

/** `supplierFlow` entries belong to the supplier/PO/RFQ workflow, which stays in code but is inactive in the first release (GLO-295). */
type NavItem = { id: string; label: string; icon: React.ElementType; href: string; comingSoon?: boolean; supplierFlow?: boolean }

const SUPPLIER_FLOW_ENABLED = process.env.NEXT_PUBLIC_SUPPLIER_WORKFLOWS === 'on'

/**
 * Mobile bottom bar: at most five slots, i.e. four primary destinations and «المزيد». `primary` names the four a role
 * uses most; the rest open in a bottom sheet. A role with five or fewer destinations shows them all, with no «المزيد».
 */
const MOBILE_SLOTS = 5

const roleNav: Record<Role, { title: string; roleLabel: string; primary?: string[]; items: NavItem[] }> = {
  admin: {
    title: 'الإدارة',
    roleLabel: 'مدير العمليات',
    primary: ['attention', 'orders', 'catalog', 'finance'],
    items: [
      { id: 'attention', label: 'نظرة عامة', icon: LayoutDashboard, href: '/admin' },
      { id: 'orders', label: 'الطلبات', icon: ShoppingBag, href: '/admin/orders' },
      { id: 'catalog', label: 'الكتالوج', icon: PackageOpen, href: '/admin/catalog' },
      { id: 'buy-list', label: 'قائمة المشتريات', icon: ClipboardList, href: '/hub/buy-list' },
      { id: 'suppliers', label: 'الموردون والتوريد', icon: Store, href: '/admin/sourcing', supplierFlow: true },
      { id: 'routines', label: 'الروتينات الجاهزة', icon: ListChecks, href: '/admin/routines' },
      { id: 'finance', label: 'المالية', icon: Wallet, href: '/admin/finance' },
      { id: 'team', label: 'الفريق', icon: Users, href: '/admin/team' },
      { id: 'settings', label: 'الإعدادات', icon: Settings2, href: '/admin/settings' },
    ],
  },
  supplier: {
    title: 'بوابة المورد',
    roleLabel: 'بوابة المورد المعتمد',
    items: [
      { id: 'rfq', label: 'طلبات التوريد المفتوحة', icon: Radio, href: '/supplier/rfq' },
      { id: 'orders', label: 'طلبات شيناكير', icon: ShoppingBag, href: '/supplier/orders' },
      { id: 'price-lists', label: 'قوائم الأسعار', icon: FileSpreadsheet, href: '/supplier/price-lists' },
    ],
  },
  hub: {
    title: 'المخزن',
    roleLabel: 'مسؤول المخزن',
    primary: ['buy-list', 'orders', 'handoff', 'returns'],
    items: [
      // One-person Hub (GLO-315): five task screens. The receive / prepare / pack / order-cost pages remain for deep links, but
      // the Orders & Preparation desk does receipt, verification, printing and packaging in one place.
      { id: 'buy-list', label: 'المشتريات', icon: ClipboardList, href: '/hub/buy-list' },
      { id: 'orders', label: 'الطلبات والتجهيز', icon: ScanLine, href: '/hub/orders' },
      { id: 'handoff', label: 'التسليم للمندوب', icon: Truck, href: '/hub/dispatch' },
      { id: 'returns', label: 'المرتجعات', icon: Undo2, href: '/hub/returns' },
      { id: 'costs', label: 'تكلفة الفواتير', icon: Wallet, href: '/hub/costs', supplierFlow: true },
    ],
  },
  driver: {
    title: 'المندوب',
    roleLabel: 'مندوب التوصيل',
    items: [
      { id: 'run', label: 'مشاويري', icon: Route, href: '/driver' },
      { id: 'history', label: 'السجل', icon: History, href: '/driver/history' },
      { id: 'account', label: 'حسابي', icon: UserRound, href: '/driver/profile' },
    ],
  },
}

function Wordmark({ onKohl }: { onKohl?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn('flex size-9 items-center justify-center rounded-bw-field border', onKohl ? 'border-bw-line bg-bw-kohl-raised text-bw-on-kohl' : 'border-bw-line bg-bw-sunken text-bw-ink')}>
        <Heart className="size-4" aria-hidden />
      </div>
      <div className="flex flex-col">
        <div className="flex items-center gap-1.5">
          <span className={cn('font-bw-display text-base font-bold tracking-tight', onKohl ? 'text-bw-on-kohl' : 'text-bw-ink')}>
            ShinaCare
          </span>
          <span className="rounded-bw-pill border border-bw-line px-1.5 text-[10px] font-semibold text-bw-ink-soft">
            أعمال
          </span>
        </div>
        <span className="text-[11px] text-bw-ink-subtle">
          لوحة العمليات الموحدة
        </span>
      </div>
    </div>
  )
}

function Count({ value }: { value?: number }) {
  if (!value) return null
  return (
    <span className="rounded-bw-pill border border-bw-line bg-bw-sunken px-2 text-[11px] font-semibold text-bw-ink-soft">
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
  hiddenNavIds,
  onLogout,
  children,
}: {
  role: Role
  active: string
  mode: WorkspaceMode
  operator: string
  task?: string
  /** Live counts from the API per nav id; never shown when absent. */
  counts?: Record<string, number | undefined>
  exitHref?: string
  /** Entries of a capability that is switched off (the API refuses those routes regardless). */
  hiddenNavIds?: string[]
  onLogout?: () => void
  children: React.ReactNode
}) {
  const nav = { ...roleNav[role], items: roleNav[role].items.filter((item) => !hiddenNavIds?.includes(item.id) && (SUPPLIER_FLOW_ENABLED || !item.supplierFlow)) }
  const isItemActive = (itemId: string) => {
    if (itemId === active) return true
    if (role === 'admin' && itemId === 'suppliers' && (active === 'sourcing' || active === 'enrollment')) return true
    if (role === 'admin' && itemId === 'catalog' && (active === 'media-templates' || active === 'intake')) return true
    if (itemId === 'orders' && (active === 'pos' || active === 'orders')) return true
    return false
  }
  const getItemCount = (itemId: string) => {
    return counts?.[itemId] ?? (itemId === 'orders' ? counts?.pos : undefined)
  }

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

  // Pure mobile frame for dedicated phone-only roles (driver)
  if (mode === 'mobile' && role !== 'supplier') {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-bw-page ring-1 ring-bw-line">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-bw-line bg-bw-page px-4 py-3">
          <Wordmark />
          <span className="flex items-center gap-3 text-bw-small text-bw-ink-soft">
            <span>
              {nav.title} · {operator}
            </span>
            {logout}
          </span>
        </header>
        <main className="flex-1 pb-4">{children}</main>
        <nav aria-label={nav.title} className="sticky bottom-0 z-10 grid grid-flow-col border-t border-bw-line bg-bw-page">
          {nav.items.map((item) => {
            const isActive = isItemActive(item.id)
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex h-bw-touch flex-col items-center justify-center border-t-2 text-bw-small transition-colors duration-150',
                  isActive ? 'border-bw-action bg-bw-sunken font-semibold text-bw-ink' : 'border-transparent text-bw-ink-soft hover:bg-bw-surface hover:text-bw-ink',
                )}
              >
                <item.icon className="size-5" aria-hidden />
                <span className="flex items-center gap-1">
                  {item.label}
                  <Count value={getItemCount(item.id)} />
                </span>
              </Link>
            )
          })}
        </nav>
      </div>
    )
  }

  // Desktop-first operational workspace (Admin, Hub desk & Supplier)
  return (
    <div className="bw-canvas flex min-h-dvh flex-col lg:flex-row">
      {/* Mobile top bar for the responsive view */}
      <header className="bw-glass sticky top-0 z-20 flex items-center justify-between border-x-0 border-t-0 px-4 py-2.5 lg:hidden">
        <Wordmark />
        <div className="flex items-center gap-3 text-bw-small text-bw-ink-soft">
          <span className="max-w-[150px] truncate font-medium text-bw-ink">{operator}</span>
          {logout}
        </div>
      </header>

      {/* Sidebar on the inline-start edge for desktop and tablet */}
      <aside className="hidden bg-bw-sidebar lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:border-e lg:border-bw-line">
        <div className="flex items-center justify-between border-b border-bw-line px-4 py-4">
          <Wordmark />
        </div>

        <div className="px-4 pb-1 pt-4 text-[11px] font-semibold text-bw-ink-subtle">
          {nav.title}
        </div>
        <nav aria-label={nav.title} className="flex flex-1 flex-col gap-0.5 px-2 py-1">
          {nav.items.map((item) => {
            if (item.comingSoon) {
              return (
                <span
                  key={item.id}
                  className="group flex h-10 shrink-0 items-center gap-2.5 rounded-bw-field px-3 text-bw-small text-bw-ink-subtle cursor-not-allowed"
                >
                  <item.icon className="size-4 shrink-0 text-bw-ink-subtle" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  <span className="rounded-bw-pill border border-bw-line px-1.5 text-[10px] font-semibold text-bw-ink-subtle">قريباً</span>
                </span>
              )
            }
            const isActive = isItemActive(item.id)
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group relative flex h-9 shrink-0 items-center gap-2.5 rounded-bw-field px-3 text-bw-small transition-colors duration-150',
                  isActive
                    ? 'bg-bw-veil-3 font-semibold text-bw-ink shadow-bw-sheen'
                    : 'text-bw-ink-soft hover:bg-bw-veil-2 hover:text-bw-ink',
                )}
              >
                {isActive ? <span aria-hidden className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-bw-cobalt" /> : null}
                <item.icon
                  className={cn(
                    'size-4 shrink-0 transition-colors duration-150',
                    isActive ? 'text-bw-cobalt' : 'text-bw-ink-subtle group-hover:text-bw-ink',
                  )}
                  aria-hidden
                />
                <span className="flex-1">{item.label}</span>
                <Count value={getItemCount(item.id)} />
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto border-t border-bw-line p-3">
          <div className="flex items-center justify-between gap-2.5 rounded-bw-field border border-bw-line p-2.5 text-bw-small text-bw-ink-soft">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-bw-pill border border-bw-line bg-bw-sunken text-[11px] font-semibold text-bw-ink">
                {operator.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-bw-small font-semibold text-bw-ink">{operator}</p>
                <p className="truncate text-[11px] text-bw-ink-subtle">{nav.roleLabel}</p>
              </div>
            </div>
            {logout}
          </div>
        </div>
      </aside>

      {/* Main operational workspace */}
      <main className="min-w-0 flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-6">{children}</main>

      <MobileNav
        title={nav.title}
        accent={role === 'admin' ? 'cobalt' : 'action'}
        items={nav.items.filter((item) => !item.comingSoon)}
        primary={nav.primary}
        isItemActive={isItemActive}
        getItemCount={getItemCount}
      />
    </div>
  )
}

/** Bottom bar: up to four primary destinations + «المزيد» (a side drawer with every remaining authorised page). */
function MobileNav({ title, accent, items, primary, isItemActive, getItemCount }: {
  title: string
  accent: 'cobalt' | 'action'
  items: NavItem[]
  primary?: string[]
  isItemActive: (id: string) => boolean
  getItemCount: (id: string) => number | undefined
}) {
  const sheet = useDialog()
  const pathname = usePathname()
  const needsMore = items.length > MOBILE_SLOTS
  // Primary ids come from the role config; the order stays the role's own order. A hidden (switched-off) item simply drops out.
  const bar = needsMore ? items.filter((item) => primary?.includes(item.id)).slice(0, MOBILE_SLOTS - 1) : items
  const more = needsMore ? items.filter((item) => !bar.includes(item)) : []
  const moreActive = more.some((item) => isItemActive(item.id))
  const moreCount = more.reduce((sum, item) => sum + (getItemCount(item.id) ?? 0), 0)

  // Close the sheet whenever navigation lands somewhere new.
  const sheetRef = sheet.ref
  React.useEffect(() => { sheetRef.current?.close() }, [pathname, sheetRef])

  const slot = 'flex h-14 min-w-0 flex-col items-center justify-center border-t-2 px-1 text-[11px] transition-colors duration-150'
  const on = accent === 'cobalt' ? 'border-bw-cobalt bg-bw-veil-3 font-semibold text-bw-ink' : 'border-bw-action bg-bw-veil-3 font-semibold text-bw-ink'
  const off = 'border-transparent text-bw-ink-soft hover:bg-bw-veil-2 hover:text-bw-ink'
  const iconOn = accent === 'cobalt' ? 'text-bw-cobalt' : 'text-bw-ink'

  return (
    <>
      <nav aria-label={title} className="bw-glass-nav fixed inset-x-0 bottom-0 z-30 grid grid-flow-col auto-cols-fr pb-[env(safe-area-inset-bottom)] lg:hidden">
        {bar.map((item) => {
          const isActive = isItemActive(item.id)
          const count = getItemCount(item.id)
          return (
            <Link key={item.id} href={item.href} aria-current={isActive ? 'page' : undefined} className={cn(slot, isActive ? on : off)}>
              <span className="relative">
                <item.icon className={cn('mb-0.5 size-[18px]', isActive ? iconOn : 'text-bw-ink-subtle')} aria-hidden />
                {count ? <span className="absolute -top-1 start-full ms-0.5 grid min-w-4 place-items-center rounded-full bg-bw-action px-1 text-[10px] font-semibold leading-4 text-bw-on-action"><bdi className="bw-code">{count}</bdi></span> : null}
              </span>
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          )
        })}
        {needsMore ? (
          <button type="button" aria-haspopup="dialog" onClick={sheet.open} className={cn(slot, moreActive ? on : off)}>
            <span className="relative">
              <Ellipsis className={cn('mb-0.5 size-[18px]', moreActive ? iconOn : 'text-bw-ink-subtle')} aria-hidden />
              {moreCount ? <span aria-hidden className="absolute -top-0.5 start-full ms-0.5 size-2 rounded-full bg-bw-action" /> : null}
            </span>
            <span>المزيد</span>
          </button>
        ) : null}
      </nav>
      {needsMore ? (
        <Dialog dialogRef={sheet.ref} title="المزيد" variant="drawer-start">
          <ul className="-mx-1 grid gap-0.5">
            {more.map((item) => {
              const isActive = isItemActive(item.id)
              const count = getItemCount(item.id)
              return (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => sheet.close()}
                    className={cn('flex h-12 items-center gap-3 rounded-bw-field px-3 text-bw-body transition-colors', isActive ? 'bg-bw-veil-3 font-semibold text-bw-ink' : 'text-bw-ink-soft hover:bg-bw-sunken hover:text-bw-ink')}
                  >
                    <item.icon className={cn('size-5 shrink-0', isActive ? iconOn : 'text-bw-ink-subtle')} aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    <Count value={count} />
                  </Link>
                </li>
              )
            })}
          </ul>
        </Dialog>
      ) : null}
    </>
  )
}
