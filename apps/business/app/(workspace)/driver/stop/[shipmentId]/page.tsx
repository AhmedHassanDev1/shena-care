'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { MapPin, Navigation, Phone } from 'lucide-react'
import { Button, Code, Field, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel } from '@/components/bw/primitives'
import { CommandError, Egp, KeyValues, Select, Status, TextArea } from '@/components/workspace/kit'
import { LoadError, RoleShell } from '@/components/workspace/role-shell'
import { api } from '@/lib/api'
import { FAILURE_REASONS, INSTRUCTION_REASONS, SHIPMENT_STATUS } from '@/lib/labels'
import { useApi, useCommand } from '@/lib/use-api'
import type { DriverRun, DriverStop } from '../../page'

/** One assigned stop: custody scan, navigation, delivery with door cash, or a typed failed attempt. */
export default function DriverStopPage() {
  const { shipmentId } = useParams<{ shipmentId: string }>()
  const { data, error, loading, reload } = useApi<DriverRun[]>('/fulfillment/driver/runs')
  const run = data?.find((r) => r.stops.some((s) => s.shipmentId === shipmentId))
  const stop = run?.stops.find((s) => s.shipmentId === shipmentId)

  return (
    <RoleShell role="driver" active="run" mode="mobile">
      <div className="space-y-4 p-4">
        <Link href="/driver" className="text-bw-small text-bw-ink-soft underline">← المشوار</Link>
        {error ? <LoadError message={error.message} onRetry={reload} /> : null}
        {!data && loading ? <Skeleton className="h-64 w-full" /> : null}
        {data && !stop ? <StateBlock kind="forbidden" title="الطرد ده مش في مشوارك" body="بتشوف بس الطرود المتعيّنة ليك." /> : null}
        {run && stop ? <StopBody runStatus={run.status} stop={stop} onChanged={reload} /> : null}
      </div>
    </RoleShell>
  )
}

function StopBody({ runStatus, stop, onChanged }: { runStatus: string; stop: DriverStop; onChanged: () => void }) {
  const active = stop.attemptStatus === 'active'
  return (
    <>
      <PageHeader eyebrow={`محطة ${stop.sequence}`} title={stop.recipientName} meta={<Code>{stop.orderNumber}</Code>} />
      <Section>
        <KeyValues rows={[
          ['العنوان', [stop.address, stop.area, stop.governorate].filter(Boolean).join('، ')],
          ['ملاحظات العميل', stop.deliveryNotes ?? '—'],
          ['القطع', <Code key="i">{stop.itemCount}</Code>],
          ['المطلوب تحصيله', <Egp key="c" value={stop.codDue} />],
          ['الحالة', <Status key="s" map={SHIPMENT_STATUS} value={stop.status} />],
        ]} />
        {stop.operatorInstruction ? (
          <div className="mt-3"><Notice tone="warn" title={`تعليمات المخزن: ${INSTRUCTION_REASONS[stop.operatorInstruction.reason] ?? stop.operatorInstruction.reason}`}>{stop.operatorInstruction.note}</Notice></div>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {stop.location ? (
            <a href={stop.location.navigationUrl} target="_blank" rel="noreferrer" className="inline-flex h-bw-touch items-center justify-center gap-2 rounded-full bg-bw-action px-4 font-semibold text-bw-on-action">
              <Navigation className="size-5" aria-hidden /> الطريق للموقع
            </a>
          ) : <StatusLabel tone="danger">مافيش موقع مؤكد</StatusLabel>}
          <a href={`tel:${stop.recipientPhone}`} className="inline-flex h-bw-touch items-center justify-center gap-2 rounded-full border-[1.5px] border-bw-line-field px-4 font-semibold">
            <Phone className="size-5" aria-hidden /> اتصل <Code>{stop.recipientPhone}</Code>
          </a>
        </div>
        {stop.location ? (
          <p className="mt-2 flex items-center gap-1 text-bw-small text-bw-ink-soft"><MapPin className="size-4" aria-hidden />دبوس العميل المؤكد <Code>{`${stop.location.latitude.toFixed(5)}, ${stop.location.longitude.toFixed(5)}`}</Code></p>
        ) : null}
      </Section>

      {active && runStatus === 'planning' ? <Handoff stop={stop} onChanged={onChanged} /> : null}
      {active && runStatus === 'dispatched' && stop.status !== 'failed' ? <Outcome stop={stop} onChanged={onChanged} /> : null}
      {active && stop.status === 'failed' ? (
        <Notice tone="warn" title="المحاولة اتسجّلت كفاشلة">الطرد لسه في عهدتك — رجّعه للمخزن، والمخزن هيمسح البوليصة ويقرّر محاولة جديدة أو إرجاع.</Notice>
      ) : null}
      {!active ? (
        <Notice tone={stop.attemptStatus === 'delivered' ? 'ok' : 'warn'} title={stop.attemptStatus === 'delivered' ? 'اتسلّم' : 'المحاولة دي اتقفلت — رجّع الطرد للمخزن'}>
          {stop.cashDeclared !== null ? <>أعلنت تحصيل <Egp value={stop.cashDeclared} /> — العدّ والتسوية بيتعملوا في المخزن.</> : null}
        </Notice>
      ) : null}
    </>
  )
}

function Handoff({ stop, onChanged }: { stop: DriverStop; onChanged: () => void }) {
  const [code, setCode] = React.useState('')
  const scan = useCommand(() => api(`/fulfillment/shipments/${stop.shipmentId}/events`, { body: { type: 'HANDOFF_SCANNED', barcode: code.trim() } }))
  if (stop.handedOver) return <Notice tone="ok" title="الطرد في عهدتك">مستني المخزن يخرّج المشوار.</Notice>
  return (
    <Section title="استلام الطرد من المخزن">
      <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); if (await scan.execute()) { setCode(''); onChanged() } }}>
        <Field label="امسح باركود البوليصة اللي على الطرد" ltr autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" size="touch" className="w-full" loading={scan.pending} disabled={!code.trim()}>تأكيد الاستلام</Button>
        <CommandError error={scan.error} />
      </form>
    </Section>
  )
}

function Outcome({ stop, onChanged }: { stop: DriverStop; onChanged: () => void }) {
  const [mode, setMode] = React.useState<'none' | 'delivered' | 'failed'>('none')
  const [cash, setCash] = React.useState('')
  const [reason, setReason] = React.useState('CUSTOMER_UNREACHABLE')
  const [notes, setNotes] = React.useState('')
  const delivered = useCommand(() => api(`/fulfillment/shipments/${stop.shipmentId}/events`, { body: { type: 'DELIVERED', collectedAmount: Number(cash) } }))
  const failed = useCommand(() => api(`/fulfillment/shipments/${stop.shipmentId}/events`, { body: { type: 'FAILED', reasonCode: reason, ...(notes.trim() ? { notes: notes.trim() } : {}) } }))
  const amount = Number(cash)
  const cashValid = cash.trim() !== '' && Number.isFinite(amount) && amount >= 0 && Math.round(amount * 100) === amount * 100

  if (mode === 'delivered') {
    return (
      <Section title="تسليم وتحصيل">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await delivered.execute()) onChanged() }}>
          <p className="text-bw-small">المطلوب من العميل: <Egp value={stop.codDue} /></p>
          <Field label="المبلغ اللي استلمته فعلاً من العميل" ltr inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
          {cashValid && amount !== stop.codDue ? <Notice tone="warn" title="المبلغ مختلف عن المطلوب">هيتسجّل زي ما هو ويظهر للمخزن والإدارة كفرق.</Notice> : null}
          <p className="text-bw-small text-bw-ink-soft">ده إعلانك إنت. التسوية النهائية بتتعمل لما المخزن يعدّ الفلوس.</p>
          <div className="flex gap-2">
            <Button type="submit" size="touch" className="flex-1" loading={delivered.pending} disabled={!cashValid}>تأكيد التسليم</Button>
            <Button variant="ghost" size="touch" onClick={() => setMode('none')}>رجوع</Button>
          </div>
          <CommandError error={delivered.error} />
        </form>
      </Section>
    )
  }
  if (mode === 'failed') {
    return (
      <Section title="المحاولة فشلت">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await failed.execute()) onChanged() }}>
          <Select label="السبب" value={reason} onChange={setReason} options={Object.entries(FAILURE_REASONS)} />
          <TextArea label="ملاحظة (اختياري)" value={notes} onChange={setNotes} />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="touch" className="flex-1" loading={failed.pending}>تسجيل المحاولة الفاشلة</Button>
            <Button variant="ghost" size="touch" onClick={() => setMode('none')}>رجوع</Button>
          </div>
          <CommandError error={failed.error} />
        </form>
      </Section>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button size="touch" onClick={() => setMode('delivered')}>اتسلّم</Button>
      <Button variant="danger" size="touch" onClick={() => setMode('failed')}>ماتسلّمش</Button>
    </div>
  )
}
