'use client'

import * as React from 'react'
import { Monitor, Smartphone } from 'lucide-react'
import {
  Button, Code, DataTable, Field, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel,
} from '@/components/bw/primitives'
import { type Role, WorkspaceFrame } from '@/components/bw/workspace-frame'

const colors = [
  ['Canvas', 'bg-bw-page', 'bw-page'],
  ['Surface', 'bg-bw-surface', 'bw-surface'],
  ['Raised', 'bg-bw-sunken', 'bw-sunken'],
  ['Primary', 'bg-bw-action', 'bw-action'],
  ['Success', 'bg-bw-ok', 'bw-ok'],
  ['Warning', 'bg-bw-warn', 'bw-warn'],
  ['Danger', 'bg-bw-danger', 'bw-danger'],
  ['Info', 'bg-bw-info', 'bw-info'],
] as const

const roles: Array<{ id: Role; title: string; mode: 'desktop' | 'mobile'; active: string }> = [
  { id: 'admin', title: 'الإدارة · سطح المكتب', mode: 'desktop', active: 'attention' },
  { id: 'hub', title: 'المخزن · سطح المكتب', mode: 'desktop', active: 'receive' },
  { id: 'supplier', title: 'المورد · الجوال', mode: 'mobile', active: 'pos' },
  { id: 'driver', title: 'المندوب · الجوال', mode: 'mobile', active: 'run' },
]

export function Playground() {
  const [role, setRole] = React.useState<Role>('admin')
  const selected = roles.find((item) => item.id === role) ?? roles[0]

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Business Design System / v1"
        title="لوحة نظام التصميم"
        meta="معاينة تطوير فقط · المكوّنات هنا لا ترسل بيانات ولا تنفّذ إجراءات تشغيلية."
      />

      <Section title="الألوان الدلالية" aside={<Code>design/tokens.css</Code>}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {colors.map(([name, color, token]) => (
            <div key={token} className="min-w-0 space-y-2">
              <div className={`h-14 rounded-bw-field border border-bw-line ${color}`} aria-hidden />
              <p className="text-bw-small font-semibold">{name}</p>
              <Code className="block truncate text-bw-ink-soft">{token}</Code>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="الخطوط والمسافات">
          <div className="space-y-3">
            <p className="font-bw-display text-bw-title font-semibold">عنوان رئيسي · <Code>24px</Code></p>
            <p className="text-bw-heading font-semibold">عنوان قسم · <Code>17px</Code></p>
            <p className="text-bw-body">نص الواجهة اليومي · <Code>15px</Code></p>
            <p className="text-bw-small text-bw-ink-soft">نص مساعد · <Code>13px</Code></p>
            <div className="flex flex-wrap items-center gap-bw-section pt-2">
              <span className="rounded-bw-field border border-bw-line px-3 py-2">حقل</span>
              <span className="rounded-bw-card border border-bw-line px-3 py-2">بطاقة</span>
              <span className="rounded-bw-pill border border-bw-line px-3 py-2">شارة</span>
            </div>
          </div>
        </Section>

        <Section title="الأزرار والحقول">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button disabled>أساسي</Button>
              <Button variant="secondary" disabled>ثانوي</Button>
              <Button variant="danger" disabled>تحذيري</Button>
              <Button variant="ghost" disabled>هادئ</Button>
              <Button loading>جارٍ التنفيذ</Button>
              <Button size="touch" disabled>هدف لمس</Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="حقل جاهز" placeholder="أدخل قيمة" readOnly />
              <Field label="حقل بخطأ" error="تحقّق من القيمة" value="" readOnly />
            </div>
          </div>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="الحالات والتنبيهات">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusLabel tone="ok">مكتمل</StatusLabel>
              <StatusLabel tone="warn">يحتاج انتباه</StatusLabel>
              <StatusLabel tone="danger">فشل</StatusLabel>
              <StatusLabel tone="info">معلومة</StatusLabel>
              <StatusLabel tone="pending">قيد الانتظار</StatusLabel>
            </div>
            <Notice tone="info" title="تنبيه معلوماتي">الحالة تظهر بنص وأيقونة مع اللون.</Notice>
            <StateBlock kind="empty" title="لا توجد عناصر" body="تُعرض الحالة الفارغة بوضوح عند غياب النتائج." />
          </div>
        </Section>

        <Section title="التحميل والجدول">
          <div className="space-y-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-10 w-full" />
            <DataTable caption="مرجع مكونات النظام" head={['المكوّن', 'الاستخدام']}>
              <tr><td>Button</td><td>الإجراءات الواضحة</td></tr>
              <tr><td>StatusLabel</td><td>الحالة بنص وأيقونة</td></tr>
            </DataTable>
          </div>
        </Section>
      </div>

      <Section title="اتجاه الكتابة والأرقام الإنجليزية">
        <div className="grid gap-3 sm:grid-cols-2">
          <div dir="rtl" className="rounded-bw-field border border-bw-line p-4">
            <p className="text-bw-small text-bw-ink-soft">العربية / RTL</p>
            <p>رمز الواجهة <Code>SKU-120/3</Code> · الوقت <Code>10:45</Code></p>
          </div>
          <div dir="ltr" lang="en" className="rounded-bw-field border border-bw-line p-4">
            <p className="text-bw-small text-bw-ink-soft">English / LTR</p>
            <p>Interface code <Code>SKU-120/3</Code> · time <Code>10:45</Code></p>
          </div>
        </div>
      </Section>

      <Section title="غلاف التطبيق حسب الدور" aside={<span className="text-bw-small text-bw-ink-soft">معاينة غير تفاعلية للهيكل المشترك</span>}>
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="اختر الدور للمعاينة">
          {roles.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setRole(item.id)}
              aria-pressed={role === item.id}
              className={`inline-flex h-bw-control items-center gap-2 rounded-bw-field border px-3 text-bw-small ${role === item.id ? 'border-bw-action bg-bw-action-soft text-bw-action-ink' : 'border-bw-line bg-bw-sunken'}`}
            >
              {item.mode === 'desktop' ? <Monitor className="size-4" aria-hidden /> : <Smartphone className="size-4" aria-hidden />}
              {item.title}
            </button>
          ))}
        </div>
        <div aria-label={`معاينة ${selected.title}`} className="max-h-[33rem] overflow-auto rounded-bw-card border border-bw-line [&_.min-h-dvh]:min-h-[25rem]" inert>
          <WorkspaceFrame role={selected.id} active={selected.active} mode={selected.mode} operator="معاينة التصميم">
            <div className="p-6">
              <p className="text-bw-heading font-semibold">منطقة محتوى الصفحة</p>
              <p className="text-bw-small text-bw-ink-soft">تتغير الملاحة حسب الدور. لا توجد بيانات تشغيلية في هذه المعاينة.</p>
            </div>
          </WorkspaceFrame>
        </div>
      </Section>
    </div>
  )
}
