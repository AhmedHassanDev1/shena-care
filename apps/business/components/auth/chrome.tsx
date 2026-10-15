'use client'

import * as React from 'react'
import { AlertCircle, CheckCircle2, Info, Truck } from 'lucide-react'

export function Brand() {
  return (
    <div className="bwa-brand">
      <span className="bwa-brand-mark" aria-hidden>
        <Truck size={22} strokeWidth={1.75} />
      </span>
      <div>
        <div className="bwa-brand-name">
          ShinaCare <span>Business</span>
        </div>
        <div className="bwa-brand-sub">مساحة أعمال شيناكير</div>
      </div>
    </div>
  )
}

const noticeIcon = { danger: AlertCircle, warn: Info, ok: CheckCircle2 } as const

/** Feedback is always icon + words. Errors interrupt (alert); neutral messages wait their turn (status). */
export function Notice({ tone, children, id }: { tone: 'danger' | 'warn' | 'ok'; children: React.ReactNode; id?: string }) {
  const Icon = noticeIcon[tone]
  return (
    <div id={id} className="bwa-notice" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden />
      <div>{children}</div>
    </div>
  )
}

export function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="bwa-help" data-tone="danger">
      <AlertCircle size={14} aria-hidden />
      <span>{children}</span>
    </p>
  )
}
