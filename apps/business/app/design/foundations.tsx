'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, Monitor, ScanLine, Smartphone } from 'lucide-react'
import {
  Button, Code, Field, Money, Notice, PageHeader, Section, Skeleton, StateBlock, StatusLabel, Stepper, SyntheticBanner,
} from '@/components/bw/primitives'

const screens = [
  { href: '/design/admin', role: 'الإدارة', title: 'محتاج تدخل + الطلبات', device: 'ديسكتوب', Icon: Monitor },
  { href: '/design/supplier', role: 'المورد', title: 'تأكيد أمر شراء', device: 'موبايل', Icon: Smartphone },
  { href: '/design/hub', role: 'المخزن', title: 'تجهيز ومسح الباركود', device: 'محطة ماسح / تابلت', Icon: ScanLine },
  { href: '/design/driver', role: 'المندوب', title: 'تسليم وتحصيل', device: 'موبايل', Icon: Smartphone },
]

const swatches: Array<[string, string, string]> = [
  ['bw-page', 'bg-bw-page', 'خلفية الصفحة'],
  ['bw-surface', 'bg-bw-surface', 'كروت، جداول، شيتات'],
  ['bw-sunken', 'bg-bw-sunken', 'رأس الجدول، مساحات هادية'],
  ['bw-ink', 'bg-bw-ink', 'النص الأساسي'],
  ['bw-ink-soft', 'bg-bw-ink-soft', 'نص ثانوي'],
  ['bw-line-field', 'bg-bw-line-field', 'حدود الحقول (3:1)'],
  ['bw-action', 'bg-bw-action', 'اللون الوحيد للأفعال'],
  ['bw-ok', 'bg-bw-ok', 'نجاح (مع أيقونة وكلام)'],
  ['bw-warn', 'bg-bw-warn', 'تنبيه'],
  ['bw-danger', 'bg-bw-danger', 'خطأ / عاجل'],
  ['bw-kohl', 'bg-bw-kohl', 'سطح محطة المسح'],
  ['bw-on-kohl-action', 'bg-bw-on-kohl-action', 'فعل على سطح الكحل'],
]

export function Foundations() {
  const [qty, setQty] = React.useState(2)
  return (
    <>
      <SyntheticBanner />
      <div className="mx-auto max-w-5xl space-y-6 p-4 lg:p-8">
        <PageHeader
          eyebrow="GLO-230 · v0.1"
          title="مساحة أعمال شينا كير — الأساسيات"
          meta="أساس واحد لأربع أدوار: الإدارة، المورد، المخزن، المندوب. عربي RTL الأول، وجاهز للـLTR."
        />

        <nav aria-label="الشاشات المرجعية" className="grid gap-3 sm:grid-cols-2">
          {screens.map((s) => (
            <Link key={s.href} href={s.href} className="flex items-center gap-3 rounded-bw-card border border-bw-line bg-bw-surface p-4 hover:border-bw-ink">
              <s.Icon className="size-6 shrink-0 text-bw-action" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-bw-small text-bw-ink-soft">{s.role} · {s.device}</span>
                <span className="block font-semibold">{s.title}</span>
              </span>
              <ArrowLeft className="size-5 text-bw-ink-soft" aria-hidden />
            </Link>
          ))}
        </nav>

        <Section title="الألوان (كلها من باليتة المتجر، بأسماء bw-*)">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {swatches.map(([name, cls, use]) => (
              <li key={name} className="flex items-center gap-2">
                <span className={`size-10 shrink-0 rounded-bw-field ring-1 ring-bw-line ${cls}`} />
                <span className="min-w-0 text-bw-small">
                  <Code className="block font-semibold">{name}</Code>
                  <span className="text-bw-ink-soft">{use}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-bw-small text-bw-ink-soft">
            كل أزواج النص ≥ <Code>4.5:1</Code> وحدود الحقول ≥ <Code>3:1</Code> — <Code>npm run check:contrast</Code>.
          </p>
        </Section>

        <Section title="الخطوط والأحجام">
          <div className="space-y-2">
            <p className="font-bw-display text-bw-figure font-semibold"><Code>1,050</Code> ج.م — رقم كبير (Alexandria)</p>
            <p className="font-bw-display text-bw-title font-semibold">عنوان الصفحة (Alexandria 24)</p>
            <p className="text-bw-heading font-semibold">عنوان قسم (17)</p>
            <p className="text-bw-body">نص الشغل اليومي — IBM Plex Sans Arabic 15، سطر 1.6.</p>
            <p className="text-bw-small text-bw-ink-soft">نص مساعد 13 — أقل حجم مسموح.</p>
          </div>
        </Section>

        <Section title="الأزرار والحقول">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button>فعل أساسي</Button>
              <Button variant="secondary">ثانوي</Button>
              <Button variant="danger">خطر</Button>
              <Button variant="ghost">هادي</Button>
              <Button loading>بيحفظ</Button>
              <Button disabled>مقفول</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="touch">زرار لمس 52px</Button>
              <Stepper label="الكمية" value={qty} max={5} onChange={setQty} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="رقم الموبايل" ltr inputMode="tel" defaultValue="01001234567" hint="أرقام إنجليزي، معزولة LTR" />
              <Field label="الكمية المتاحة" ltr inputMode="numeric" defaultValue="-1" error="الكمية لازم تكون صفر أو أكتر" />
            </div>
          </div>
        </Section>

        <Section title="الحالة دايمًا أيقونة + كلام">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <StatusLabel tone="ok">اتأكد</StatusLabel>
              <StatusLabel tone="warn">جزئي</StatusLabel>
              <StatusLabel tone="danger">مش متاح</StatusLabel>
              <StatusLabel tone="neutral">بيتجهز</StatusLabel>
              <StatusLabel tone="pending">مستني السيرفر</StatusLabel>
            </div>
            <Notice tone="ok" title="اتبعت التأكيد">إيصال <Code>CNF-1042-01</Code></Notice>
            <Notice tone="warn" title="التكلفة اتغيرت">هتتراجع قبل الاعتماد.</Notice>
            <Notice tone="danger" title="معرفناش نحفظ">مفيش حاجة اتغيرت. حاول تاني.</Notice>
          </div>
        </Section>

        <Section title="الاتجاه (bidi): أكواد وأرقام جوه نص عربي">
          <ul className="space-y-1">
            <li>أمر شراء <Code>PO-1042</Code> فيه <Code>3</Code> بنود بإجمالي <Money value={2475} /></li>
            <li>الباركود <Code>6224000445566</Code> — <Code>SKU-CRM-250</Code></li>
            <li>اتصل على <Code>+20 100 123 4567</Code></li>
            <li>مؤكد <Code>2</Code> من <Code>4</Code> قطع</li>
          </ul>
          <p className="mt-2 text-bw-small text-bw-ink-soft">
            أي كود أو رقم أو تليفون جوه <Code>{'<Code>'}</Code> (bdi + LTR + أرقام بعرض ثابت). أرقام غربية دايمًا.
          </p>
        </Section>

        <Section title="حالات فاضي / تحميل / خطأ / ممنوع">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-bw-card border border-bw-line"><StateBlock kind="empty" title="مفيش حاجة هنا" body="هيظهر هنا أول ما يحصل." /></div>
            <div className="space-y-2 rounded-bw-card border border-bw-line p-4" aria-busy="true" aria-label="جاري التحميل">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
            <div className="rounded-bw-card border border-bw-line"><StateBlock kind="error" title="حصل خطأ" body="مفيش حاجة اتغيرت." /></div>
            <div className="rounded-bw-card border border-bw-line"><StateBlock kind="forbidden" title="مش ضمن صلاحياتك" body="الصلاحيات بتتحدد من السيرفر." /></div>
          </div>
        </Section>

        <Section title="LTR (English) — same primitives, logical properties">
          <div dir="ltr" lang="en" className="space-y-3">
            <Notice tone="warn" title="Cost changed" action={<Button variant="secondary">Review</Button>}>
              PO <Code>PO-1042</Code> · line <Code>2</Code> of <Code>3</Code>
            </Notice>
            <div className="flex flex-wrap items-center gap-2">
              <StatusLabel tone="ok">Confirmed</StatusLabel>
              <Button>Primary</Button>
              <Stepper label="Quantity" value={qty} max={5} onChange={setQty} />
            </div>
          </div>
        </Section>
      </div>
    </>
  )
}
