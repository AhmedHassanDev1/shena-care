'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Icon } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import type { Messages } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';
import type { ShinaActivityState } from '../lib/shina-types';
import { ShinaMascot } from './ShinaMascot';

export interface ShinaActivityCapsuleProps {
  state: ShinaActivityState;
  detail?: string;
  onCancel?: () => void;
  onRetry?: () => void;
  className?: string;
}

export function activityLabelForState(state: ShinaActivityState, m: Messages): string | null {
  switch (state) {
    case 'thinking':
      return m.shinaStateThinking;
    case 'searching':
      return m.shinaStateSearching;
    case 'comparing':
      return m.shinaStateComparing;
    case 'routine':
      return m.shinaStateRoutine;
    case 'recommending':
      return m.shinaStateRecommending;
    case 'streaming':
      return m.shinaStateStreaming;
    case 'clarification':
      return m.shinaStateClarification;
    case 'completed':
      return m.shinaStateCompleted;
    case 'warning':
      return m.shinaStateWarning;
    case 'listening':
      return m.shinaStateListening;
    default:
      return null;
  }
}

function isAbortableState(state: ShinaActivityState): boolean {
  return (
    state === 'thinking' ||
    state === 'searching' ||
    state === 'comparing' ||
    state === 'routine' ||
    state === 'recommending' ||
    state === 'streaming'
  );
}

// ─── Micro-animation sub-components ───────────────────────────────────────────

/** thinking: 3-dot staggered opacity pulse */
function ThinkingDots({ reduced }: { reduced: boolean }) {
  const dots = [0, 1, 2];
  return (
    <span className="flex items-center gap-px pe-1" aria-hidden="true">
      {dots.map((i) => (
        <motion.span
          key={i}
          className="inline-block size-1.5 rounded-full bg-cobalt"
          animate={
            reduced
              ? undefined
              : { opacity: [0.3, 1, 0.3] }
          }
          transition={
            reduced
              ? undefined
              : {
                  duration: 1.2,
                  ease: 'easeInOut',
                  repeat: Infinity,
                  delay: i * 0.2,
                }
          }
        />
      ))}
    </span>
  );
}

/** searching: shimmer sweep left-to-right */
function SearchingShimmer({ reduced }: { reduced: boolean }) {
  return (
    <span
      className="relative inline-flex h-4 w-8 shrink-0 overflow-hidden rounded-pill pe-1"
      aria-hidden="true"
    >
      <motion.span
        className="absolute inset-0 bg-gradient-to-r from-transparent via-cobalt/30 to-transparent"
        animate={reduced ? undefined : { x: ['-100%', '200%'] }}
        transition={
          reduced
            ? undefined
            : { duration: 1.4, ease: 'linear', repeat: Infinity }
        }
        style={{ width: '60%' }}
      />
    </span>
  );
}

/** comparing: two mini bars alternating opacity */
function ComparingBars({ reduced }: { reduced: boolean }) {
  return (
    <span className="flex items-center gap-1 pe-1" aria-hidden="true">
      <motion.span
        className="inline-block h-3 w-1 rounded-pill bg-cobalt"
        animate={reduced ? undefined : { opacity: [1, 0.4, 1] }}
        transition={
          reduced
            ? undefined
            : { duration: 1, ease: 'easeInOut', repeat: Infinity }
        }
      />
      <motion.span
        className="inline-block h-3 w-1 rounded-pill bg-cobalt"
        animate={reduced ? undefined : { opacity: [0.4, 1, 0.4] }}
        transition={
          reduced
            ? undefined
            : { duration: 1, ease: 'easeInOut', repeat: Infinity }
        }
      />
    </span>
  );
}

/** routine: 3 bars sequentially fill scaleX then hold */
function RoutineBars({ reduced }: { reduced: boolean }) {
  const bars = [0, 1, 2];
  return (
    <span className="flex items-center gap-0.5 pe-1" aria-hidden="true">
      {bars.map((i) => (
        <motion.span
          key={i}
          className="inline-block h-1.5 w-3 origin-start rounded-pill bg-cobalt/60"
          animate={reduced ? undefined : { scaleX: [0, 1, 1] }}
          transition={
            reduced
              ? undefined
              : {
                  duration: 1.5,
                  ease: 'easeOut',
                  repeat: Infinity,
                  repeatDelay: 0.4,
                  delay: i * 0.3,
                }
          }
        />
      ))}
    </span>
  );
}

/** recommending: sparkles icon pulsing opacity */
function RecommendingSparkle({ reduced }: { reduced: boolean }) {
  return (
    <motion.span
      className="inline-flex shrink-0 items-center text-cobalt pe-1"
      animate={reduced ? undefined : { opacity: [0.5, 1, 0.5] }}
      transition={
        reduced
          ? undefined
          : { duration: 1.6, ease: 'easeInOut', repeat: Infinity }
      }
      aria-hidden="true"
    >
      <Icon name="sparkles" size={16} />
    </motion.span>
  );
}

/** streaming: block cursor blink */
function StreamingCursor({ reduced }: { reduced: boolean }) {
  return (
    <motion.span
      className="inline-block h-3.5 w-0.5 shrink-0 rounded-pill bg-ink pe-px"
      animate={reduced ? undefined : { opacity: [1, 0, 1] }}
      transition={
        reduced
          ? undefined
          : { duration: 0.7, ease: 'linear', repeat: Infinity }
      }
      aria-hidden="true"
    />
  );
}

/** warning: one-shot ring pulse (scale+opacity, no loop) */
function WarningRing({ reduced }: { reduced: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 rounded-pill border border-tomato/60"
      initial={{ scale: 1, opacity: 0.6 }}
      animate={{ scale: 1.15, opacity: 0 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
      aria-hidden="true"
    />
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ShinaActivityCapsule({
  state,
  detail,
  onCancel,
  onRetry,
  className,
}: ShinaActivityCapsuleProps) {
  const m = useMessages();
  const prefersReducedMotion = Boolean(useReducedMotion());
  const label = activityLabelForState(state, m);

  if (!label || state === 'idle') {
    return null;
  }

  const isWarning = state === 'warning';
  const isListening = state === 'listening';
  const isCompleted = state === 'completed';
  const isClarification = state === 'clarification';
  const isThinking = state === 'thinking';
  const isSearching = state === 'searching';
  const isComparing = state === 'comparing';
  const isRoutine = state === 'routine';
  const isRecommending = state === 'recommending';
  const isStreaming = state === 'streaming';
  const abortable = isAbortableState(state);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={state}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        initial={prefersReducedMotion ? false : { opacity: 0, y: 6, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4, scale: 0.98 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: 'easeOut' }}
        className={cn(
          'relative inline-flex min-h-12 max-w-full items-center gap-2 rounded-pill border px-2.5 py-1 shadow-elevation-1 backdrop-blur-md',
          isWarning
            ? 'border-tomato/35 bg-linen/85 text-tomato-ink'
            : isListening
              ? 'border-cobalt/40 bg-linen/85 text-ink shadow-halo-cobalt'
              : isCompleted
                ? 'border-ok/35 bg-linen/85 text-ink'
                : 'border-linen/80 bg-linen/75 text-ink',
          className,
        )}
      >
        {/* Warning one-shot ring pulse */}
        {isWarning ? <WarningRing reduced={prefersReducedMotion} /> : null}

        <ShinaMascot state={state} size="xs" decorative />

        <div className="min-w-0 flex-1 pe-1">
          <p className="truncate font-display text-13 font-bold leading-tight text-inherit">
            {label}
          </p>
          {detail ? (
            <p className="truncate text-11 leading-tight text-stone">
              {detail}
            </p>
          ) : null}
        </div>

        {/* Per-state animation indicators */}
        {isThinking ? (
          <ThinkingDots reduced={prefersReducedMotion} />
        ) : null}

        {isSearching ? (
          <SearchingShimmer reduced={prefersReducedMotion} />
        ) : null}

        {isComparing ? (
          <ComparingBars reduced={prefersReducedMotion} />
        ) : null}

        {isRoutine ? (
          <RoutineBars reduced={prefersReducedMotion} />
        ) : null}

        {isRecommending ? (
          <RecommendingSparkle reduced={prefersReducedMotion} />
        ) : null}

        {isStreaming ? (
          <StreamingCursor reduced={prefersReducedMotion} />
        ) : null}

        {/* Listening: existing equalizer bars — preserved exactly */}
        {isListening ? (
          <div className="flex h-4 items-end gap-0.5 pe-1.5" aria-hidden="true">
            <span className="h-3.5 w-1 rounded-full bg-cobalt shina-eq-1" />
            <span className="h-4 w-1 rounded-full bg-cobalt shina-eq-2" />
            <span className="h-3 w-1 rounded-full bg-cobalt shina-eq-3" />
            <span className="h-4 w-1 rounded-full bg-citron shina-eq-4" />
          </div>
        ) : null}

        {/* Completed: existing check icon — preserved exactly */}
        {isCompleted ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ok-tint text-ok">
            <Icon name="check" size={16} strokeWidth={2.2} />
          </span>
        ) : null}

        {isClarification ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sand text-cobalt">
            <Icon name="message" size={16} />
          </span>
        ) : null}

        {abortable && onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label={m.shinaCancelRequest}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-chalk text-stone transition-colors hover:border-tomato hover:text-tomato-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            <Icon name="stop" size={14} />
          </button>
        ) : null}

        {isWarning && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            aria-label={m.shinaRetryAction}
            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-pill border border-tomato/30 bg-chalk px-2.5 text-11 font-bold text-tomato-ink transition-colors hover:bg-tomato/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
          >
            <Icon name="retry" size={14} />
            <span>{m.shinaRetryAction}</span>
          </button>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}
