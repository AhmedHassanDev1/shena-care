'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpLeft,
  Banknote,
  ChartNoAxesColumnIncreasing,
  CircleHelp,
  Package,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import {
  Button,
  Code,
  DataTable,
  PageHeader,
  Section,
  Skeleton,
  StateBlock,
} from '@/components/bw/primitives';
import { Egp, Status } from '@/components/workspace/kit';
import { RoleShell } from '@/components/workspace/role-shell';
import { AttentionQueues } from '@/components/workspace/overview/attention-queues';
import type { Attention } from '@/components/workspace/overview/types';
import {
  attentionCounts,
  orderBuckets,
  type OverviewOrder,
  type OrderBucket,
} from '@/lib/admin-overview';
import { ORDER_STATUS, formatDateTime } from '@/lib/labels';
import { useApi } from '@/lib/use-api';
import type { ApiError } from '@/lib/api';
import './overview.css';

const number = (value: number) => value.toLocaleString('en-US');
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Africa/Cairo',
  }).format(new Date(`${date}T12:00:00Z`));

function ReadError({ error, retry }: { error: ApiError; retry: () => void }) {
  return (
    <StateBlock
      kind={error.status === 403 ? 'forbidden' : 'error'}
      title={error.status === 403 ? 'لا تملك صلاحية عرض هذه البيانات' : 'تعذّر تحديث البيانات'}
      body="لم يتم اعتبار البيانات غير المتاحة صفرًا. يمكنك إعادة المحاولة."
      action={
        <Button variant="secondary" onClick={retry}>
          إعادة المحاولة
        </Button>
      }
    />
  );
}

function MiniBars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="ao-mini" role="img" aria-label={`${label}: ${values.map(number).join('، ')}`}>
      {values.map((v, i) => (
        <span key={i} style={{ height: `${(v / max) * 100}%` }} />
      ))}
    </div>
  );
}

function OrdersChart({ buckets }: { buckets: OrderBucket[] }) {
  const [selected, setSelected] = useState(6);
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const b = buckets[selected];
  return (
    <>
      <div className="ao-chart-readout" aria-live="polite">
        <span>{dayLabel(b.date)}</span>
        <strong>
          <Code>{number(b.total)}</Code> طلب
        </strong>
        <span>
          تم التسليم {number(b.delivered)} · قيد التنفيذ {number(b.active)} · حالات أخرى{' '}
          {number(b.other)}
        </span>
      </div>
      <div className="ao-chart" aria-label="حالة الطلبات حسب يوم إنشائها" dir="ltr">
        {buckets.map((bucket, index) => (
          <button
            type="button"
            key={bucket.date}
            className="ao-column"
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
            onFocus={() => setSelected(index)}
            onMouseEnter={() => setSelected(index)}
            aria-label={`${dayLabel(bucket.date)}: ${bucket.total} طلب، تم التسليم ${bucket.delivered}، قيد التنفيذ ${bucket.active}، حالات أخرى ${bucket.other}`}
          >
            <span className="ao-bar-space">
              <span className="ao-stack" style={{ height: `${(bucket.total / max) * 100}%` }}>
                <span className="ao-segment-other" style={{ flex: bucket.other }} />
                <span className="ao-segment-active" style={{ flex: bucket.active }} />
                <span className="ao-segment-delivered" style={{ flex: bucket.delivered }} />
              </span>
            </span>
            <span className="ao-day" dir="rtl">
              {dayLabel(bucket.date)}
            </span>
          </button>
        ))}
      </div>
      <div className="ao-legend">
        <span>
          <i className="ao-segment-delivered" />
          تم التسليم
        </span>
        <span>
          <i className="ao-segment-active" />
          قيد التنفيذ
        </span>
        <span>
          <i className="ao-segment-other" />
          ملغي / مرتجع / أخرى
        </span>
      </div>
    </>
  );
}

function Overview() {
  const attention = useApi<Attention>('/operations/queues/attention', { pollMs: 30000 });
  const kpis = useApi<{ ordersToday: number; totalOrders: number }>('/operations/dashboard/kpis', {
    pollMs: 30000,
  });
  const orders = useApi<{ total: number; items: OverviewOrder[] }>(
    '/admin/orders?take=100&skip=0',
    { pollMs: 30000 },
  );
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const a = attention.error ? undefined : attention.data;
  const counts = a ? attentionCounts(a) : undefined;
  const waiting = counts?.reduce((sum, n) => sum + n, 0);
  const rows = orders.error ? undefined : orders.data?.items;
  const buckets = rows ? orderBuckets(rows) : undefined;
  const filtered = rows?.filter(
    (o) =>
      (filter === 'all' || o.status === filter) &&
      `${o.orderNumber} ${o.customerName}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const refreshing = attention.loading || kpis.loading || orders.loading;
  const refresh = () => {
    attention.reload();
    kpis.reload();
    orders.reload();
  };
  return (
    <div className="ao-content">
      <div className="ao-topbar">
        <span>
          <ShieldCheck size={15} aria-hidden /> مساحة الإدارة <span className="ao-divider">/</span>{' '}
          نظرة عامة
        </span>
        <span>
          تحديث تلقائي كل <Code>30</Code> ثانية
        </span>
      </div>
      <div className="ao-page">
        <PageHeader
          eyebrow="SHINACARE / OPERATIONS"
          title="نظرة عامة على العمليات"
          meta="قرارات أوضح. طلبات تتحرك. تحصيل تحت المتابعة."
          actions={
            <Button variant="secondary" loading={refreshing} onClick={refresh}>
              <RefreshCw size={15} aria-hidden />
              تحديث البيانات
            </Button>
          }
        />
        <div className="ao-kpis">
          <section className="ao-kpi ao-priority" aria-labelledby="action-title">
            <div className="ao-kpi-top">
              <span className="ao-icon">
                <TriangleAlert size={20} aria-hidden />
              </span>
              <h2 id="action-title">إجراءات تحتاج تدخلك</h2>
              <span className="ao-kicker">01</span>
            </div>
            {attention.error ? (
              <ReadError error={attention.error} retry={attention.reload} />
            ) : counts ? (
              <>
                <div className="ao-kpi-value">
                  <Code>{number(waiting!)}</Code>
                  <span>بند متابعة</span>
                </div>
                <div className="ao-kpi-visual">
                  <p>
                    التوفير، التوزيع، التوصيل والاستثناءات
                    <br />
                    قد يظهر الطلب في أكثر من قائمة
                  </p>
                  <MiniBars
                    values={counts}
                    label="التوفير، قرارات العملاء، التوزيع، التوصيل، فروق النقدية، الحالات"
                  />
                </div>
              </>
            ) : (
              <Skeleton className="h-28" />
            )}
            <a href="#action-center" className="ao-kpi-footer">
              افتح مركز التدخلات <ArrowLeft size={16} aria-hidden />
            </a>
          </section>
          <section className="ao-kpi" aria-labelledby="orders-title">
            <div className="ao-kpi-top">
              <span className="ao-icon">
                <Package size={20} aria-hidden />
              </span>
              <h2 id="orders-title">طلبات اليوم</h2>
              <span className="ao-kicker">02</span>
            </div>
            {kpis.error ? (
              <ReadError error={kpis.error} retry={kpis.reload} />
            ) : kpis.data ? (
              <>
                <div className="ao-kpi-value">
                  <Code>{number(kpis.data.ordersToday)}</Code>
                  <span>طلب</span>
                </div>
                <div className="ao-kpi-visual">
                  <p>
                    حسب يوم العمل في الخادم
                    <br />
                    الأعمدة: عينة آخر 7 أيام
                  </p>
                  {buckets ? (
                    <MiniBars
                      values={buckets.map((b) => b.total)}
                      label="عينة الطلبات حسب يوم الإنشاء"
                    />
                  ) : (
                    <span>الرسم غير متاح</span>
                  )}
                </div>
              </>
            ) : (
              <Skeleton className="h-28" />
            )}
            <Link href="/admin/orders" className="ao-kpi-footer">
              متابعة جميع الطلبات <ArrowLeft size={16} aria-hidden />
            </Link>
          </section>
          <section className="ao-kpi" aria-labelledby="cash-title">
            <div className="ao-kpi-top">
              <span className="ao-icon">
                <Banknote size={20} aria-hidden />
              </span>
              <h2 id="cash-title">تحصيلات تنتظر العدّ</h2>
              <span className="ao-kicker">03</span>
            </div>
            {attention.error ? (
              <ReadError error={attention.error} retry={attention.reload} />
            ) : a ? (
              <>
                <div className="ao-kpi-value">
                  <Code>{number(a.deliveredUnsettled.total)}</Code>
                  <span>تحصيل COD</span>
                </div>
                <div className="ao-kpi-visual">
                  <p>
                    أعلنها المندوب ولم تُعدّ بعد
                    <br />
                    إجمالي المبلغ غير متاح
                  </p>
                  <MiniBars
                    values={[
                      a.deliveredUnsettled.total,
                      a.cashVariances.short.total,
                      a.cashVariances.over.total,
                    ]}
                    label="بانتظار العدّ، عجز، زيادة"
                  />
                </div>
              </>
            ) : (
              <Skeleton className="h-28" />
            )}
            <Link href="/admin/cash" className="ao-kpi-footer">
              مراجعة النقدية والتسويات <ArrowLeft size={16} aria-hidden />
            </Link>
          </section>
        </div>
        <div className="ao-main-grid">
          <Section
            title={
              <span className="ao-title-icon">
                <ChartNoAxesColumnIncreasing size={18} aria-hidden />
                حركة الطلبات
              </span>
            }
            aside={<span className="ao-chip">آخر 7 أيام · القاهرة</span>}
            className="ao-chart-panel"
          >
            <div className="ao-section-intro">
              <p>الحالة الحالية حسب تاريخ إنشاء الطلب</p>
              <span className="ao-chip">
                عينة حتى <Code>100</Code> طلب
              </span>
            </div>
            {orders.error ? (
              <ReadError error={orders.error} retry={orders.reload} />
            ) : !buckets ? (
              <Skeleton className="h-72" />
            ) : buckets.every((b) => b.total === 0) ? (
              <StateBlock
                kind="empty"
                title="لا توجد طلبات في العينة خلال هذه الفترة"
                body="سيظهر الرسم عند توفر طلبات ضمن آخر 7 أيام."
              />
            ) : (
              <OrdersChart buckets={buckets} />
            )}
            <p className="ao-footnote">
              <CircleHelp size={14} aria-hidden />
              {rows ? `آخر ${number(rows.length)} من ${number(orders.data!.total)} طلب. ` : ''}هذا
              الرسم لا يمثل توقيت التسليم أو إجمالي نشاط اليوم.
            </p>
          </Section>
          <section id="action-center" className="ao-action-panel" aria-labelledby="action-heading">
            <div className="ao-action-heading">
              <div>
                <p className="ao-eyebrow">الخطوة التالية</p>
                <h2 id="action-heading">مركز التدخلات التشغيلية</h2>
              </div>
              <span className="ao-status-dot" aria-hidden />
            </div>
            <p className="ao-action-description">
              الأقدم في كل قائمة أولًا؛ افتح الطلب لاتخاذ القرار.
            </p>
            {attention.error ? (
              <ReadError error={attention.error} retry={attention.reload} />
            ) : !a ? (
              <Skeleton className="h-64" />
            ) : (
              <>
                {waiting === 0 &&
                a.deliveredUnsettled.total === 0 &&
                !a.eventFailures.failed.length &&
                !a.eventFailures.dead.length ? (
                  <StateBlock
                    kind="empty"
                    title="لا توجد تدخلات معلّقة"
                    body="تابع الطلبات الجديدة من قائمة الطلبات."
                  />
                ) : (
                  <AttentionQueues a={a} />
                )}
                <p className="ao-footnote">
                  تُعرض حتى 10 عناصر من كل قائمة. أحداث النظام معروضة كعينة منفصلة عن عدد بنود
                  المتابعة.
                </p>
              </>
            )}
          </section>
        </div>
        <Section
          title="أحدث الطلبات"
          aside={
            <Link href="/admin/orders" className="ao-text-link">
              جميع الطلبات <ArrowUpLeft size={15} aria-hidden />
            </Link>
          }
          className="ao-recent"
        >
          <div className="ao-table-tools">
            <div className="ao-tabs" aria-label="تصفية أحدث الطلبات">
              {[
                ['all', 'الكل'],
                ['placed', 'بانتظار التوفير'],
                ['shipped', 'مع المندوب'],
                ['delivered', 'تم التسليم'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="ao-search">
              <span className="sr-only">بحث ضمن آخر 100 طلب</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث برقم الطلب أو اسم العميل…"
              />
            </label>
          </div>
          {orders.error ? (
            <ReadError error={orders.error} retry={orders.reload} />
          ) : !filtered ? (
            <Skeleton className="h-56" />
          ) : !filtered.length ? (
            <StateBlock
              kind="empty"
              title="لا توجد طلبات مطابقة في العينة"
              action={
                <Link href="/admin/orders" className="ao-text-link">
                  البحث في جميع الطلبات ←
                </Link>
              }
            />
          ) : (
            <DataTable
              caption="أحدث الطلبات — حتى 6 نتائج من آخر 100 طلب"
              head={[
                'الطلب',
                'العميل / المنطقة',
                'قيمة الطلب',
                'القطع',
                'الحالة',
                'تاريخ الإنشاء',
                '',
              ]}
            >
              {filtered.slice(0, 6).map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/admin/orders/${o.id}`} className="ao-order-id">
                      <Code>{o.orderNumber}</Code>
                    </Link>
                  </td>
                  <td>
                    <strong>{o.customerName}</strong>
                    <small className="ao-cell-sub">
                      {[o.area, o.governorate].filter(Boolean).join('، ') || 'المنطقة غير متاحة'}
                    </small>
                  </td>
                  <td>
                    <Egp value={o.totalAmount} />
                    <small className="ao-cell-sub">
                      <Code>{o.paymentMethod}</Code>
                      {o.codAmount !== null ? (
                        <>
                          {' '}
                          · للتحصيل <Egp value={o.codAmount} />
                        </>
                      ) : null}
                    </small>
                  </td>
                  <td>
                    <Code>{number(o.itemCount)}</Code>
                  </td>
                  <td>
                    <Status map={ORDER_STATUS} value={o.status} />
                  </td>
                  <td className="ao-date">{formatDateTime(o.createdAt)}</td>
                  <td>
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className="ao-detail-link"
                      aria-label={`عرض الطلب ${o.orderNumber}`}
                    >
                      <ArrowUpLeft size={17} aria-hidden />
                    </Link>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
          <p className="ao-footnote">
            البحث والتصفية ضمن آخر 100 طلب. التحصيل للصيدلية منفصل عن مستحقات الموردين وحصة المؤسس.
          </p>
        </Section>
        <footer className="ao-page-footer">
          <span>
            ShinaCare <span>Business</span>
          </span>
          <span>بيانات تشغيلية من مصادرها الأصلية</span>
        </footer>
      </div>
    </div>
  );
}

export default function AdminHome() {
  return (
    <div className="bw-admin-overview">
      <RoleShell overview role="admin" active="attention" mode="desktop">
        <Overview />
      </RoleShell>
    </div>
  );
}
