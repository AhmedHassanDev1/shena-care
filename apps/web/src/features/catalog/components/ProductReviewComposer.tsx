'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { AsyncButton, Button, type AsyncState } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TextAreaField } from '@/components/ui/field';
import { Icon } from '@/components/ui/icon';
import { MessageBox } from '@/components/ui/message-box';
import { Skeleton } from '@/components/ui/skeleton';
import { Toast } from '@/components/ui/toast';
import { apiErrorCode, isTransportFailure } from '@/features/auth/lib/auth-helpers';
import { useAuth } from '@/features/auth/AuthContext';
import { ApiError } from '@/lib/api-client';
import { formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage, type Messages } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import type { ProductReview } from '../api/discovery';
import type { ReviewEligibilityReason } from '../api/product-reviews.api';
import { useReviewEligibility, useSubmitProductReview } from '../hooks/useProductReviewActions';

interface ProductReviewComposerProps {
  slug: string;
  skuId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: (review: ProductReview) => void;
}

function blockedMessageForReason(reason: ReviewEligibilityReason, m: Messages): string {
  switch (reason) {
    case 'ALREADY_REVIEWED':
      return m.pdpReviewBlockedAlready;
    case 'NOT_YET_DELIVERED':
      return m.pdpReviewBlockedNotDelivered;
    case 'CANCELLED_OR_REFUNDED':
      return m.pdpReviewBlockedCancelled;
    case 'ACCOUNT_INACTIVE':
      return m.pdpReviewBlockedInactive;
    case 'NO_PURCHASE':
    default:
      return m.pdpReviewBlockedNoPurchase;
  }
}

function resolveSubmitErrorMessage(error: unknown, m: Messages): string {
  if (error instanceof ApiError && error.status === 429) {
    return m.pdpReviewRateLimited;
  }
  const code = apiErrorCode(error);
  switch (code) {
    case 'REVIEW_ALREADY_EXISTS':
      return m.pdpReviewBlockedAlready;
    case 'NOT_YET_DELIVERED':
      return m.pdpReviewBlockedNotDelivered;
    case 'CANCELLED_OR_REFUNDED':
      return m.pdpReviewBlockedCancelled;
    case 'NO_PURCHASE':
    case 'VERIFIED_PURCHASE_REQUIRED':
      return m.pdpReviewBlockedNoPurchase;
    case 'ACCOUNT_INACTIVE':
      return m.pdpReviewBlockedInactive;
    case 'REVIEW_RATE_LIMITED':
      return m.pdpReviewRateLimited;
    default:
      return isTransportFailure(error) ? m.pdpReviewSubmitError : m.pdpReviewSubmitError;
  }
}

export function ProductReviewComposer({
  slug,
  skuId,
  open,
  onOpenChange,
  onSubmitted,
}: ProductReviewComposerProps) {
  const m = useMessages();
  const locale = useLocale();
  const { user, isAuthenticated } = useAuth();

  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [body, setBody] = useState('');
  const [ratingError, setRatingError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitState, setSubmitState] = useState<AsyncState>('idle');
  const [submittedReview, setSubmittedReview] = useState<ProductReview | null>(null);

  const eligibilityQuery = useReviewEligibility(slug, open && isAuthenticated, user?.id);
  const submitMutation = useSubmitProductReview(slug);

  useEffect(() => {
    if (!open) {
      setRating(0);
      setHoveredRating(0);
      setBody('');
      setRatingError('');
      setSubmitError('');
      setSubmitState('idle');
      setSubmittedReview(null);
    }
  }, [open]);

  const activeStars = hoveredRating || rating;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitState === 'pending') return;

    if (rating < 1 || rating > 5) {
      setRatingError(m.pdpReviewRatingRequired);
      return;
    }

    setRatingError('');
    setSubmitError('');
    setSubmitState('pending');

    try {
      const trimmedBody = body.trim();
      const result = await submitMutation.mutateAsync({
        rating,
        ...(trimmedBody ? { body: trimmedBody } : {}),
        ...(skuId ? { skuId } : {}),
      });
      setSubmitState('success');
      setSubmittedReview(result.review);
      onSubmitted?.(result.review);
    } catch (error) {
      setSubmitState('idle');
      setSubmitError(resolveSubmitErrorMessage(error, m));
      if (apiErrorCode(error) === 'REVIEW_ALREADY_EXISTS') {
        void eligibilityQuery.refetch();
      }
    }
  }

  const eligibility = eligibilityQuery.data;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => submitState !== 'pending' && onOpenChange(nextOpen)}>
      <DialogContent
        closeLabel={m.close}
        className="max-w-[460px] rounded-24 bg-linen p-6 sm:p-7 shadow-elevation-3 font-display border border-sand/40"
      >
        <DialogHeader className="pe-10">
          <DialogTitle className="font-display text-22 font-semibold tracking-tight text-ink">
            {m.pdpReviewDialogTitle}
          </DialogTitle>
          <DialogDescription className="text-14 text-stone leading-relaxed">
            {m.pdpReviewDialogDesc}
          </DialogDescription>
        </DialogHeader>

        {submittedReview ? (
          <div className="mt-5 flex flex-col gap-4">
            <Toast
              className="w-full"
              subtitle={submittedReview.isTest ? m.pdpReviewSuccessTest : undefined}
            >
              {submittedReview.isTest ? m.pdpReviewTestBadge : m.pdpReviewSuccess}
            </Toast>
            <Button
              type="button"
              variant="light"
              size="m"
              className="w-full rounded-pill"
              onClick={() => onOpenChange(false)}
            >
              {m.close}
            </Button>
          </div>
        ) : eligibilityQuery.isLoading ? (
          <div className="mt-6 flex flex-col items-center justify-center gap-3 py-6 text-stone">
            <Skeleton className="h-4 w-44 rounded-pill" />
            <span className="text-14 font-medium">{m.pdpReviewChecking}</span>
          </div>
        ) : eligibilityQuery.isError ? (
          <div className="mt-5 flex flex-col gap-4">
            <MessageBox tone="err" role="alert">
              <p className="m-0 text-14 text-ink">{m.pdpReviewsError}</p>
            </MessageBox>
            <Button
              type="button"
              variant="light"
              size="m"
              className="w-full rounded-pill"
              onClick={() => void eligibilityQuery.refetch()}
            >
              {m.tryAgain}
            </Button>
          </div>
        ) : eligibility && !eligibility.canReview ? (
          <div className="mt-5 flex flex-col gap-4">
            <MessageBox
              tone={eligibility.reason === 'ALREADY_REVIEWED' ? 'info' : 'warn'}
              role="status"
            >
              <p className="m-0 text-14 leading-22 text-ink">
                {blockedMessageForReason(eligibility.reason, m)}
              </p>
            </MessageBox>
            <Button
              type="button"
              variant="light"
              size="m"
              className="w-full rounded-pill"
              onClick={() => onOpenChange(false)}
            >
              {m.close}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="mt-5 flex flex-col gap-5">
            {eligibility?.isTestMode ? (
              <MessageBox tone="warn" role="status">
                <p className="m-0 text-13 font-medium leading-20 text-ink">{m.pdpReviewTestBanner}</p>
              </MessageBox>
            ) : null}

            <fieldset className="border-0 p-0 m-0">
              <legend className="text-14 font-semibold text-ink mb-2">
                {m.pdpYourRating}
              </legend>
              <div
                role="radiogroup"
                aria-label={m.pdpYourRating}
                className="inline-flex items-center gap-1"
                onMouseLeave={() => setHoveredRating(0)}
              >
                {[1, 2, 3, 4, 5].map((star) => {
                  const selected = star <= activeStars;
                  return (
                    <button
                      key={star}
                      type="button"
                      role="radio"
                      aria-checked={rating === star}
                      aria-label={fillMessage(m.pdpRateStar, { n: formatNumber(star, locale) })}
                      onMouseEnter={() => setHoveredRating(star)}
                      onClick={() => {
                        setRating(star);
                        if (ratingError) setRatingError('');
                      }}
                      className={cn(
                        'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt',
                        selected ? 'bg-sand/50' : 'hover:bg-sand/30',
                      )}
                    >
                      <Icon
                        name="star"
                        size={26}
                        strokeWidth={1.5}
                        fill={selected ? 'currentColor' : 'none'}
                        className={selected ? 'text-warn' : 'text-stone/40'}
                      />
                    </button>
                  );
                })}
              </div>
              {ratingError ? (
                <p role="alert" className="m-0 mt-1.5 text-13 font-medium text-tomato-ink">
                  {ratingError}
                </p>
              ) : null}
            </fieldset>

            <TextAreaField
              label={m.pdpYourReview}
              optionalLabel={m.checkoutOptional}
              placeholder={m.pdpReviewPlaceholder}
              rows={3}
              maxLength={2000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />

            {submitError ? (
              <MessageBox tone="err" role="alert">
                <p className="m-0 text-14 text-ink">{submitError}</p>
              </MessageBox>
            ) : null}

            <AsyncButton
              type="submit"
              size="l"
              state={submitState}
              pendingLabel={m.pdpReviewSubmitting}
              className="w-full rounded-pill bg-cobalt text-chalk hover:bg-cobalt-deep font-semibold"
            >
              {m.pdpSendReview}
            </AsyncButton>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
