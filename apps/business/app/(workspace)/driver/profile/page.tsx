'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2,
  LogOut,
  Mail,
  ShieldCheck,
  User,
  UserRound,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/bw/primitives'
import { RoleShell, useMe } from '@/components/workspace/role-shell'
import { useSession } from '@/lib/session'

/**
 * Driver Profile & Settings — الملف الشخصي للمندوب
 * Mobile-first clean interface with large readable cards and fast actions.
 */
export default function DriverProfile() {
  return (
    <RoleShell role="driver" active="account" mode="mobile">
      <ProfileBody />
    </RoleShell>
  )
}

function ProfileBody() {
  const me = useMe()
  const { logout } = useSession()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = React.useState(false)

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await logout()
      router.replace('/login')
    } finally {
      setLoggingOut(false)
    }
  }

  return (
    <div className="space-y-4 p-3 sm:p-4 pb-24 max-w-lg mx-auto">
      {/* Title */}
      <div>
        <h1 className="font-bw-display text-xl sm:text-2xl font-bold text-bw-ink">
          حسابي
        </h1>
        <p className="text-xs text-bw-ink-soft mt-0.5">
          بيانات المندوب وحالة الحساب
        </p>
      </div>

      {/* Driver ID Card */}
      <section className="rounded-2xl border border-bw-line bg-bw-surface p-4 space-y-3.5 shadow-bw-card">
        <div className="flex items-center gap-3.5">
          <div className="grid size-14 place-items-center rounded-2xl bg-bw-action-soft text-bw-action-ink border border-bw-line shrink-0">
            <UserRound className="size-7" aria-hidden />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-base text-bw-ink truncate">
              {me.name}
            </h2>
            <div className="flex items-center gap-1.5 text-xs text-bw-ink-soft mt-0.5 truncate">
              <Mail className="size-3.5 text-bw-ink-subtle shrink-0" aria-hidden />
              <span className="truncate">{me.email}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-bw-cobalt/15 text-bw-cobalt border border-bw-cobalt/30">
                <ShieldCheck className="size-3" aria-hidden />
                مندوب توصيل معتمد
              </span>
              <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                متصل وفي الخدمة
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Financial Custody Guidance Card */}
      <section className="rounded-2xl border border-emerald-500/30 bg-emerald-950/15 p-4 space-y-2">
        <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
          <Wallet className="size-4 shrink-0" aria-hidden />
          <span>تنبيه النقدية والعهدة</span>
        </div>
        <p className="text-xs text-emerald-200/90 leading-relaxed font-medium">
          المبالغ النقدية التي تقوم بتحصيلها من العملاء تظل في عهدتك الشخصية كأمانة حتى تسليمها لكاشير المخزن في نهاية المشوار لإجراء المطابقة وإغلاق المشوار.
        </p>
      </section>

      {/* Logout Action */}
      <div className="pt-2">
        <Button
          type="button"
          variant="danger"
          size="touch"
          onClick={handleLogout}
          loading={loggingOut}
          className="w-full h-12 text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
        >
          <LogOut className="size-4" aria-hidden />
          <span>تسجيل الخروج من الحساب</span>
        </Button>
      </div>
    </div>
  )
}
