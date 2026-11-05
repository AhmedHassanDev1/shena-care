'use client'

import * as React from 'react'
import {
  Button, Checkbox, Code, DataTable, Dialog, Field, Notice, PageHeader, Search, Section, Select, Skeleton, StateBlock, StatusLabel, Switch, Tabs, Toast, useDialog,
} from '@/components/bw/primitives'
import { type Role, type WorkspaceMode, WorkspaceFrame } from '@/components/bw/workspace-frame'

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

const shellPreviews: Array<{ role: Role; active: string; mode: WorkspaceMode; label: string }> = [
  { role: 'admin', active: 'orders', mode: 'desktop', label: 'الإدارة' },
  { role: 'hub', active: 'receive', mode: 'desktop', label: 'المخزن' },
  { role: 'supplier', active: 'rfq', mode: 'desktop', label: 'المورد' },
  { role: 'driver', active: 'run', mode: 'mobile', label: 'التوصيل' },
]

export function Playground() {
  const [tab, setTab] = React.useState('one')
  const dialog = useDialog()

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="نظام تصميم الإدارة"
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
              <Button>أساسي</Button>
              <Button variant="secondary">ثانوي</Button>
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
        <Section title="الاختيار والبحث">
          <div className="space-y-4">
            <Search label="بحث" placeholder="ابحث عن عنصر" />
            <Select label="التصفية" options={[{ value: 'all', label: 'كل العناصر' }, { value: 'active', label: 'النشطة' }]} />
            <Checkbox label="إظهار العناصر النشطة" defaultChecked />
            <Switch label="التنبيهات" defaultChecked />
          </div>
        </Section>
        <Section title="التبويبات والطبقات">
          <div className="space-y-4">
            <Tabs id="showcase-tabs" label="أقسام المعاينة" value={tab} onChange={setTab} items={[{ value: 'one', label: 'الأول' }, { value: 'two', label: 'الثاني' }]} />
            <p id="showcase-tabs-panel" role="tabpanel" aria-labelledby={`showcase-tabs-${tab}`} className="text-bw-small text-bw-ink-soft">{tab === 'one' ? 'محتوى التبويب الأول' : 'محتوى التبويب الثاني'}</p>
            <Button variant="secondary" onClick={dialog.open}>افتح الحوار</Button>
            <Dialog dialogRef={dialog.ref} title="حوار توضيحي" footer={<Button onClick={dialog.close}>إغلاق</Button>}>
              لا تُنفّذ هذه المعاينة أي إجراء تشغيلي.
            </Dialog>
            <Toast tone="ok" title="تم الحفظ">مثال على رسالة الحالة.</Toast>
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

      <Section title="غلاف مساحات العمل" aside={<span className="text-bw-small text-bw-ink-soft">معاينة غير تفاعلية · نفس النظام للأدوار الأربعة</span>}>
        <div className="grid gap-4 xl:grid-cols-2">
          {shellPreviews.map(({ role, active, mode, label }) => (
            <div key={role} className="space-y-2">
              <p className="text-bw-small font-semibold text-bw-ink-soft">{label}</p>
              <div aria-label={`معاينة غلاف ${label}`} className="max-h-[28rem] overflow-auto rounded-bw-card border border-bw-line [&_.min-h-dvh]:min-h-[22rem]" inert>
                <WorkspaceFrame role={role} active={active} mode={mode} operator="معاينة التصميم">
                  <div className="p-6">
                    <p className="text-bw-heading font-semibold">منطقة محتوى الصفحة</p>
                    <p className="text-bw-small text-bw-ink-soft">تتغير الملاحة حسب الدور. لا توجد بيانات تشغيلية في هذه المعاينة.</p>
                  </div>
                </WorkspaceFrame>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
