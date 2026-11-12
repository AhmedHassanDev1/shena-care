'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLink } from '@/components/ui/arrow-link';
import { AsyncButton, Button, type AsyncState } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { TextAreaField, TextField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip, type StatusTone } from '@/components/ui/status-chip';
import { useAuth } from '@/features/auth/AuthContext';
import { formatDate } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import type { Messages } from '@/lib/i18n/messages';
import type { MyOrder } from '@/lib/orders';
import { routes } from '@/lib/routes';
import {
  MY_SUPPORT_CASES_QUERY_KEY,
  SUPPORT_CASE_CATEGORIES,
  supportApi,
  type CustomerSupportCase,
  type SupportCaseCategory,
  type SupportCaseStatus,
} from '@/lib/support';

export interface SupportHelpSectionProps {
  orders: MyOrder[];
  onSessionExpired?: () => void;
}

function supportStatusTone(status: SupportCaseStatus): StatusTone {
  switch (status) {
    case 'resolved':
      return 'ok';
    case 'in_progress':
      return 'warn';
    case 'closed':
      return 'gray';
    default:
      return 'cobalt';
  }
}

function supportStatusLabel(status: SupportCaseStatus, m: Messages): string {
  return m[`profileSupportStatus${status}` as keyof Messages] as string;
}

function supportCategoryLabel(category: CustomerSupportCase['category'], m: Messages): string {
  const key = `orderSupportTopic${category}` as keyof Messages;
  if (key in m && typeof m[key] === 'string') return m[key] as string;
  return m.orderSupportTopicother;
}

/**
 * Help, Returns & Support section wired directly to real ShinaCare workflows:
 * - Item returns & delivery problem reporting on individual orders (/orders/[id])
 * - Submitting general or order-linked support requests (POST /operations/support/cases)
 * - Viewing the signed-in customer's own submitted requests (GET /operations/support/cases/mine)
 */
export function SupportHelpSection({ orders, onSessionExpired }: SupportHelpSectionProps) {
  const m = useMessages();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();

  const [formOpen, setFormOpen] = useState(false);
  const [category, setCategory] = useState<SupportCaseCategory>('delivery');
  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<AsyncState>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sentNotice, setSentNotice] = useState(false);

  const casesQuery = useQuery({
    queryKey: MY_SUPPORT_CASES_QUERY_KEY,
    queryFn: () => supportApi.listMine(5),
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (casesQuery.error && (casesQuery.error as { status?: number }).status === 401) {
      onSessionExpired?.();
    }
  }, [casesQuery.error, onSessionExpired]);

  const preferredOrder = orders.find((o) => o.stage === 'DELIVERED') ?? orders[0];
  const returnsHref = preferredOrder ? routes.order(preferredOrder.orderNumber) : routes.myOrders;
  const orderNumberById = new Map(orders.map((o) => [o.id, o.orderNumber]));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitState === 'pending') return;

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    let hasError = false;

    if (trimmedTitle.length < 3) {
      setTitleError(m.profileSupportSubjectError);
      hasError = true;
    } else {
      setTitleError(null);
    }

    if (trimmedDescription.length < 10) {
      setDescriptionError(m.profileSupportMessageError);
      hasError = true;
    } else {
      setDescriptionError(null);
    }

    if (hasError) return;

    setSubmitError(null);
    setSentNotice(false);
    setSubmitState('pending');

    try {
      await supportApi.create({
        title: trimmedTitle,
        description: trimmedDescription,
        category,
        orderId: selectedOrderId || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: MY_SUPPORT_CASES_QUERY_KEY });
      setTitle('');
      setDescription('');
      setSelectedOrderId('');
      setSubmitState('idle');
      setFormOpen(false);
      setSentNotice(true);
    } catch (err: unknown) {
      setSubmitState('idle');
      const status = (err as { status?: number })?.status;
      if (status === 401) {
        onSessionExpired?.();
        return;
      }
      setSubmitError(m.orderSupportFailed);
    }
  };

  const recentCases = casesQuery.data ?? [];

  return (
    <section
      id="account-support"
      aria-labelledby="profile-support-heading"
      className="scroll-mt-24 rounded-card border border-line bg-linen p-5 md:p-6"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 flex-none place-items-center rounded-pill bg-chalk text-cobalt shadow-outline-control"
        >
          <Icon name="message" size={18} />
        </span>
        <div>
          <h2
            id="profile-support-heading"
            className="m-0 font-display text-22 font-extrabold leading-28 text-ink"
          >
            {m.profileSupportTitle}
          </h2>
          <p className="m-0 mt-1.5 text-14 leading-22 text-stone">{m.profileSupportPolicySummary}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
        <ArrowLink href={returnsHref} className="justify-between text-15">
          <span className="inline-flex items-center gap-2">
            <Icon name="returns" size={17} />
            <span>{m.profileSupportReturnLink}</span>
          </span>
        </ArrowLink>

        <div>
          <Button
            type="button"
            variant={formOpen ? 'ghost' : 'cobalt'}
            size="m"
            onClick={() => {
              setFormOpen((prev) => !prev);
              setSubmitError(null);
            }}
            className="w-full justify-center sm:w-auto"
          >
            {formOpen ? m.profileSupportCloseForm : m.profileSupportOpenForm}
          </Button>
        </div>
      </div>

      {sentNotice ? (
        <MessageBox tone="ok" className="mt-4" role="status">
          {m.profileSupportSent}
        </MessageBox>
      ) : null}

      {formOpen ? (
        <form onSubmit={handleSubmit} noValidate className="mt-5 flex flex-col gap-4 border-t border-line pt-5">
          {submitError ? <MessageBox tone="err">{submitError}</MessageBox> : null}

          <div className="flex flex-col gap-2">
            <span className="font-display text-15 font-semibold text-ink">{m.orderSupportTopic}</span>
            <div className="flex flex-wrap gap-2">
              {SUPPORT_CASE_CATEGORIES.map((cat) => (
                <Chip
                  key={cat}
                  selected={category === cat}
                  onClick={() => setCategory(cat)}
                >
                  {supportCategoryLabel(cat, m)}
                </Chip>
              ))}
            </div>
          </div>

          {orders.length > 0 ? (
            <div className="flex flex-col gap-2">
              <label htmlFor="support-order-select" className="font-display text-15 font-semibold text-ink">
                {m.profileSupportOrderLabel}{' '}
                <span className="text-13 font-normal text-stone">({m.checkoutOptional})</span>
              </label>
              <select
                id="support-order-select"
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                className="h-control-m w-full rounded-input border border-line-2 bg-chalk px-3.5 font-display text-15 text-ink focus:border-cobalt focus:outline-none"
              >
                <option value="">{m.profileSupportOrderNone}</option>
                {orders.slice(0, 10).map((o) => (
                  <option key={o.id} value={o.id}>
                    #{o.orderNumber} · {formatDate(o.createdAt, locale)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <TextField
            id="support-subject-input"
            label={m.profileSupportSubjectLabel}
            placeholder={m.profileSupportSubjectPlaceholder}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (titleError) setTitleError(null);
            }}
            error={titleError ?? undefined}
            maxLength={120}
          />

          <TextAreaField
            id="support-description-input"
            label={m.orderSupportMessage}
            placeholder={m.profileSupportMessagePlaceholder}
            rows={3}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              if (descriptionError) setDescriptionError(null);
            }}
            error={descriptionError ?? undefined}
            maxLength={1000}
          />

          <div className="flex flex-wrap items-center gap-2.5">
            <AsyncButton
              type="submit"
              variant="cobalt"
              size="m"
              state={submitState}
              pendingLabel={m.profileSavingChanges}
            >
              {m.orderSupportSend}
            </AsyncButton>
            <Button
              type="button"
              variant="ghost"
              size="m"
              onClick={() => setFormOpen(false)}
              disabled={submitState === 'pending'}
            >
              {m.profileAddressCancel}
            </Button>
          </div>
        </form>
      ) : null}

      {casesQuery.isLoading ? (
        <div className="mt-5 flex flex-col gap-2.5 border-t border-line pt-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : casesQuery.error ? (
        <p className="m-0 mt-4 border-t border-line pt-4 text-13 text-tomato-ink">
          {m.profileSupportCasesLoadError}
        </p>
      ) : recentCases.length > 0 ? (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="m-0 mb-3 font-display text-15 font-bold text-ink">
            {m.profileSupportCasesTitle}
          </h3>
          <ul className="m-0 list-none divide-y divide-line rounded-input border border-line bg-chalk p-0">
            {recentCases.map((c) => {
              const linkedOrderNumber = c.orderId ? orderNumberById.get(c.orderId) : undefined;
              return (
                <li key={c.id} className="flex flex-col gap-1.5 px-3.5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-display text-15 font-semibold text-ink">{c.title}</span>
                    <StatusChip tone={supportStatusTone(c.status)}>
                      {supportStatusLabel(c.status, m)}
                    </StatusChip>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-12 text-stone">
                    <span>{supportCategoryLabel(c.category, m)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDate(c.createdAt, locale)}</span>
                    {linkedOrderNumber ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <bdi dir="ltr">#{linkedOrderNumber}</bdi>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
