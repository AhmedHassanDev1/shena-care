'use client'

import * as React from 'react'
import { ArrowLeft, RefreshCw, UserCheck } from 'lucide-react'
import { WorkspaceFrame } from '@/components/bw/workspace-frame'
import {
  Button, Code, DataTable, Dialog, DesignNotes, Money, Notice, PageHeader, QueueRow, Section, Skeleton, StateBlock,
  StatusLabel, useDialog, type Tone,
} from '@/components/bw/primitives'
import { cn } from '@/lib/utils'
import type { ScreenState } from '../states'

type AdminState = ScreenState<'admin'>

type Kind = 'supply' | 'price' | 'delivery' | 'cod' | 'support'
const kindLabel: Record<Kind, string> = { supply: 'التوريد', price: 'الأسعار', delivery: 'التوصيل', cod: 'التحصيل', support: 'الدعم' }

type Item = {
  id: string
  kind: Kind
  tone: Tone
  urgent: boolean
  title: React.ReactNode
  detail: React.ReactNode
  age: string
  facts: Array<[string, React.ReactNode]>
  next: string
}

/* Synthetic reference content — not live data. */
const items: Item[] = [
  {
    id: 'a1', kind: 'supply', tone: 'danger', urgent: true,
    title: 'المورد أكد صفر من 3 وحدات',
    detail: <>أمر شراء <Code>PO-1042</Code> · سيروم نياسيناميد 30 مل · بيأثر على طلبين</>,
    age: 'من 25 دقيقة',
    facts: [['أمر الشراء', <Code key="po">PO-1042</Code>], ['المطلوب / المؤكد', <Code key="q">3 / 0</Code>], ['طلبات متأثرة', <><Code>ORD-20412</Code>، <Code>ORD-20415</Code></>]],
    next: 'شوف عروض موردين تانيين للمنتج، أو اطلب قرار العميل (استبدال / إلغاء البند).',
  },
  {
    id: 'a2', kind: 'cod', tone: 'danger', urgent: true,
    title: <>فرق تحصيل <Money value={150} /></>,
    detail: <>المندوب كريم ع. · مشوار <Code>RUN-0318</Code></>,
    age: 'من ساعة',
    facts: [['المتوقع', <Money key="e" value={4820} />], ['المسلَّم للمخزن', <Money key="d" value={4670} />], ['الحالة', 'مستني مراجعة المشرف']],
    next: 'راجع إيصالات المحطات قبل اعتماد التسوية. التسوية مش بتتقفل من هنا.',
  },
  {
    id: 'a3', kind: 'price', tone: 'warn', urgent: false,
    title: 'سعر البيع أقل من تكلفة المورد الجديدة',
    detail: <>كريم مرطب 250 مل · <Code>SKU-CRM-250</Code></>,
    age: 'من ساعتين',
    facts: [['سعر البيع النشط', <Money key="s" value={360} />], ['آخر تكلفة مؤكدة', <Money key="c" value={372} />], ['مصدر التكلفة', 'تأكيد أمر شراء']],
    next: 'افتح المنتج في شاشة الأسعار وحدد سعر جديد أو أوقف البيع مؤقتًا.',
  },
  {
    id: 'a4', kind: 'delivery', tone: 'warn', urgent: false,
    title: 'محاولة توصيل فشلت — العميل مبيردش',
    detail: <><Code>ORD-20398</Code> · مدينة نصر · المحاولة الأولى</>,
    age: 'من 3 ساعات',
    facts: [['المندوب', 'محمود ح.'], ['الشحنة', 'رجعت مع المندوب'], ['المبلغ المطلوب', <Money key="m" value={1050} />]],
    next: 'حدد ميعاد محاولة تانية أو رجّع الشحنة للمخزن.',
  },
  {
    id: 'a5', kind: 'supply', tone: 'warn', urgent: false,
    title: 'أمر شراء مستني تأكيد المورد',
    detail: <><Code>PO-1045</Code> · مورد الدلتا · 4 بنود</>,
    age: 'من 3 ساعات',
    facts: [['اتبعت للمورد', 'النهارده 10:05'], ['البنود', <Code key="l">4</Code>]],
    next: 'ذكّر المورد أو اختار مصدر تاني.',
  },
  {
    id: 'a6', kind: 'price', tone: 'warn', urgent: false,
    title: 'منتج متاح من غير سعر بيع نشط',
    detail: <>غسول وش 200 مل · <Code>SKU-CLN-200</Code></>,
    age: 'امبارح',
    facts: [['عروض موردين', <Code key="o">2</Code>], ['حالة العرض للعميل', 'مخفي']],
    next: 'حدد سعر بيع عشان المنتج يظهر للعملاء.',
  },
  {
    id: 'a7', kind: 'support', tone: 'neutral', urgent: false,
    title: 'العميلة عايزة تغير عنوان التوصيل',
    detail: <><Code>ORD-20431</Code> · لسه متجهزش</>,
    age: 'امبارح',
    facts: [['حالة الطلب', 'مستني تأكيد المورد']],
    next: 'غيّر العنوان من صفحة الطلب قبل ما يتجهز.',
  },
]

const orders: Array<{ id: string; area: string; status: [Tone, string]; supply: [Tone, string]; total: number; updated: string }> = [
  { id: 'ORD-20431', area: 'الدقي، الجيزة', status: ['pending', 'مستني تأكيد المورد'], supply: ['pending', '0 من 2 مؤكد'], total: 720, updated: '10:42' },
  { id: 'ORD-20415', area: 'المعادي، القاهرة', status: ['danger', 'محتاج قرار'], supply: ['danger', 'بند ناقص'], total: 1150, updated: '10:31' },
  { id: 'ORD-20412', area: 'فيصل، الجيزة', status: ['danger', 'محتاج قرار'], supply: ['danger', 'بند ناقص'], total: 485, updated: '10:30' },
  { id: 'ORD-20406', area: 'مصر الجديدة، القاهرة', status: ['neutral', 'بيتجهز'], supply: ['ok', 'كله مؤكد'], total: 2340, updated: '09:58' },
  { id: 'ORD-20398', area: 'مدينة نصر، القاهرة', status: ['warn', 'توصيل فشل'], supply: ['ok', 'كله مؤكد'], total: 1050, updated: '09:12' },
  { id: 'ORD-20377', area: 'الهرم، الجيزة', status: ['ok', 'اتسلم'], supply: ['ok', 'كله مؤكد'], total: 850, updated: 'امبارح' },
]

export function AdminAttentionCenter({ state }: { state: AdminState }) {
  const [filter, setFilter] = React.useState<Kind | 'all'>('all')
  const [selected, setSelected] = React.useState<Item | null>(null)
  const drawer = useDialog()

  const visible = filter === 'all' ? items : items.filter((i) => i.kind === filter)
  const counts = items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }), {})

  const open = (item: Item) => {
    setSelected(item)
    drawer.open()
  }

  return (
    <WorkspaceFrame role="admin" active="attention" mode="desktop" operator="منى س. · مشرفة عمليات">
      <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
        {state === 'forbidden' ? (
          <Section>
            <StateBlock kind="forbidden" title="الصفحة دي مش ضمن صلاحياتك" body="الصلاحيات بتتحدد من السيرفر حسب دورك. لو محتاج وصول، كلم مدير النظام." />
          </Section>
        ) : (
          <>
            <PageHeader
              eyebrow="الأربعاء 14 أكتوبر · اتحدث من دقيقة"
              title="محتاج تدخل"
              meta={state === 'default' ? <><Code>{items.length}</Code> حاجات مفتوحة · <Code>{items.filter((i) => i.urgent).length}</Code> عاجلة</> : null}
              actions={
                <Button variant="secondary" loading={state === 'loading'}>
                  <RefreshCw className="size-4" aria-hidden />
                  تحديث
                </Button>
              }
            />

            {state === 'error' ? (
              <Notice tone="danger" title="معرفناش نحمّل قائمة المتابعة" action={<Button variant="secondary">حاول تاني</Button>}>
                مفيش أي تغيير اتعمل. لو المشكلة استمرت، الخدمة ممكن تكون واقفة — بلّغ الدعم الفني.
              </Notice>
            ) : null}

            <div role="group" aria-label="نوع المشكلة" className="flex flex-wrap gap-2">
              {(['all', ...Object.keys(kindLabel)] as Array<Kind | 'all'>).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                  className={cn(
                    'h-bw-control rounded-full border-[1.5px] px-4 text-bw-small',
                    filter === k ? 'border-bw-ink bg-bw-ink font-semibold text-bw-surface' : 'border-bw-line-field bg-bw-surface',
                  )}
                >
                  {k === 'all' ? 'الكل' : kindLabel[k]}{' '}
                  {state === 'default' ? <Code>{k === 'all' ? items.length : (counts[k] ?? 0)}</Code> : null}
                </button>
              ))}
            </div>

            <Section title="الاستثناءات المفتوحة" aside={<span className="text-bw-small text-bw-ink-soft">الأقدم والأخطر الأول</span>} className="[&>div:last-child]:p-0">
              {state === 'loading' ? (
                <div className="space-y-3 p-4" aria-busy="true" aria-label="جاري التحميل">
                  {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
                </div>
              ) : state === 'empty' ? (
                <StateBlock kind="empty" title="مفيش حاجة محتاجة تدخل دلوقتي" body="أي استثناء في التوريد أو الأسعار أو التوصيل أو التحصيل هيظهر هنا أول ما يحصل." />
              ) : state === 'error' ? (
                <StateBlock kind="error" title="القائمة مش متاحة" />
              ) : (
                <ul>
                  {visible.map((item) => (
                    <QueueRow
                      key={item.id}
                      tone={item.tone}
                      selected={selected?.id === item.id}
                      title={<>{item.urgent ? <span className="me-2"><StatusLabel tone="danger">عاجل</StatusLabel></span> : null}{item.title}</>}
                      detail={item.detail}
                      meta={<>{kindLabel[item.kind]} · {item.age}</>}
                      action={<Button variant="secondary" onClick={() => open(item)}>مراجعة</Button>}
                    />
                  ))}
                </ul>
              )}
            </Section>

            {state === 'default' ? (
              <Section title="الطلبات النهارده" aside={<a href="#" className="inline-flex min-h-6 items-center text-bw-small font-semibold text-bw-action">كل الطلبات</a>} className="[&>div:last-child]:p-0">
                <DataTable caption="طلبات النهارده" head={['الطلب', 'المنطقة', 'الحالة', 'التوريد', 'الإجمالي (عند الاستلام)', 'آخر تحديث', '']}>
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-bw-page">
                      <td className="font-semibold"><Code>{o.id}</Code></td>
                      <td>{o.area}</td>
                      <td><StatusLabel tone={o.status[0]}>{o.status[1]}</StatusLabel></td>
                      <td><StatusLabel tone={o.supply[0]}>{o.supply[1]}</StatusLabel></td>
                      <td><Money value={o.total} /></td>
                      <td className="text-bw-small text-bw-ink-soft"><Code>{o.updated}</Code></td>
                      <td>
                        <a href="#" className="inline-flex min-h-6 items-center gap-1 text-bw-small font-semibold text-bw-action">
                          فتح <ArrowLeft className="size-4" aria-hidden />
                        </a>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              </Section>
            ) : null}
          </>
        )}

        <DesignNotes
          reusable={['PageHeader', 'فلاتر Pill بـ aria-pressed', 'QueueRow: أيقونة + كلام + زرار واحد', 'DataTable بأعمدة أرقام LTR', 'Drawer (dialog أصلي) للتفاصيل', 'StateBlock: فاضي / خطأ / ممنوع']}
          specific={['ترتيب الاستثناءات: العاجل والأقدم الأول', 'الدرج بيعرض الحقائق والخطوة الجاية بس؛ التنفيذ في شاشة الوحدة المالكة', 'مفيش لوحة رسوم بيانية']}
          open={['ترتيب الأولوية بين الأنواع (توريد قبل تحصيل؟)', 'مدة "عاجل" لكل نوع']}
        />
      </div>

      <Dialog
        dialogRef={drawer.ref}
        variant="drawer"
        title={selected ? kindLabel[selected.kind] : ''}
        onClose={() => setSelected(null)}
        footer={
          <>
            <Button variant="secondary">
              <UserCheck className="size-4" aria-hidden />
              خليها عليّا
            </Button>
            <Button>افتح في الشاشة المسؤولة</Button>
          </>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-bw-heading font-semibold">{selected.title}</p>
              <p className="text-bw-small text-bw-ink-soft">{selected.detail}</p>
            </div>
            <dl className="divide-y divide-bw-line rounded-bw-card border border-bw-line">
              {selected.facts.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-bw-ink-soft">{k}</dt>
                  <dd className="font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <Notice tone="neutral" title="الخطوة الجاية">{selected.next}</Notice>
          </div>
        ) : null}
      </Dialog>
    </WorkspaceFrame>
  )
}
