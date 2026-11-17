'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Icon } from '@/components/ui/icon';
import { useMessages, useLocale } from '@/lib/i18n/LocaleProvider';
import { cn } from '@/lib/utils';
import type { ShinaActivityState } from '../lib/shina-types';

export interface ShinaActivityCapsuleProps {
  state: ShinaActivityState;
  detail?: string;
  onCancel?: () => void;
  onRetry?: () => void;
  className?: string;
}

/**
 * Concise single-word status labels in the clean style of modern AI assistants (ChatGPT style):
 * "Thinking...", "Searching...", "Comparing...", "Exploring..."
 */
export function activityWordForState(state: ShinaActivityState, locale: string = 'ar'): string | null {
  if (locale === 'ar') {
    switch (state) {
      case 'thinking':
        return 'أفكر…';
      case 'searching':
        return 'أبحث…';
      case 'comparing':
        return 'أقارن…';
      case 'routine':
        return 'أرتب…';
      case 'recommending':
        return 'أستكشف…';
      case 'streaming':
        return 'أكتب…';
      case 'clarification':
        return 'أستوضح…';
      case 'completed':
        return 'جاهز';
      case 'warning':
        return 'توقف مؤقت';
      case 'listening':
        return 'أستمع…';
      default:
        return null;
    }
  }

  switch (state) {
    case 'thinking':
      return 'Thinking…';
    case 'searching':
      return 'Searching…';
    case 'comparing':
      return 'Comparing…';
    case 'routine':
      return 'Sequencing…';
    case 'recommending':
      return 'Exploring…';
    case 'streaming':
      return 'Writing…';
    case 'clarification':
      return 'Clarifying…';
    case 'completed':
      return 'Ready';
    case 'warning':
      return 'Interrupted';
    case 'listening':
      return 'Listening…';
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

/**
 * High-energy, compact kinetic glyphs (Micro 3D SVG & kinetic physics).
 * Super crisp, fast, striking transitions designed to stay tiny and elegant.
 */
function ActionMotionGlyph({ state, reduced }: { state: ShinaActivityState; reduced: boolean }) {
  if (reduced) {
    return <span className="size-2.5 rounded-full bg-cobalt" />;
  }

  switch (state) {
    case 'searching':
      // Dynamic scanning radar with orbital particle sweep
      return (
        <span className="relative flex size-6 items-center justify-center">
          <motion.span
            className="absolute inset-0 rounded-full border-2 border-cobalt/35"
            animate={{ scale: [0.65, 1.45], opacity: [0.9, 0] }}
            transition={{ duration: 0.95, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.span
            className="absolute inset-1 rounded-full border border-dashed border-citron"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
          />
          <motion.span
            className="size-2 rounded-full bg-cobalt shadow-halo-cobalt"
            animate={{ scale: [0.8, 1.25, 0.8] }}
            transition={{ duration: 0.7, repeat: Infinity, ease: 'easeInOut' }}
          />
        </span>
      );

    case 'comparing':
      // 3D Orbital flip: two dynamic glowing nodes revolving around an axis
      return (
        <span className="relative flex size-6 items-center justify-center">
          <svg className="size-full overflow-visible" viewBox="0 0 24 24">
            <motion.ellipse
              cx="12"
              cy="12"
              rx="10"
              ry="4"
              fill="none"
              stroke="rgb(var(--cobalt-rgb) / 0.45)"
              strokeWidth="1.5"
              strokeDasharray="4 2"
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
              style={{ originX: '12px', originY: '12px' }}
            />
          </svg>
          <motion.span
            className="absolute size-2.5 rounded-full bg-cobalt shadow-halo-cobalt"
            animate={{
              x: [-8, 8, -8],
              scale: [1, 0.75, 1],
              zIndex: [1, 2, 1],
            }}
            transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.span
            className="absolute size-2.5 rounded-full bg-citron shadow-elevation-1"
            animate={{
              x: [8, -8, 8],
              scale: [0.75, 1, 0.75],
              zIndex: [2, 1, 2],
            }}
            transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        </span>
      );

    case 'recommending':
      // Kinetic 4-point golden Sparkle Star rotation + pulse
      return (
        <span className="relative flex size-6 items-center justify-center">
          <motion.div
            className="flex items-center justify-center text-citron"
            animate={{
              rotate: [0, 90, 180, 270, 360],
              scale: [0.85, 1.2, 0.85],
            }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 0L14.8 9.2L24 12L14.8 14.8L12 24L9.2 14.8L0 12L9.2 9.2L12 0Z"
                fill="rgb(var(--citron-rgb))"
              />
            </svg>
          </motion.div>
          <motion.span
            className="absolute size-1.5 rounded-full bg-cobalt"
            animate={{ scale: [1.2, 0.7, 1.2] }}
            transition={{ duration: 0.75, repeat: Infinity, ease: 'easeInOut' }}
          />
        </span>
      );

    case 'routine':
      // 3-tier sequenced cascade bars jumping with spring energy
      return (
        <span className="relative flex h-5 w-6 items-end justify-center gap-1 pb-0.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="w-1.5 rounded-pill bg-cobalt shadow-elevation-1"
              animate={{
                height: ['4px', '16px', '4px'],
                backgroundColor: [
                  'rgb(var(--cobalt-rgb))',
                  'rgb(var(--citron-rgb))',
                  'rgb(var(--cobalt-rgb))',
                ],
              }}
              transition={{
                duration: 0.75,
                repeat: Infinity,
                delay: i * 0.14,
                ease: 'easeInOut',
              }}
            />
          ))}
        </span>
      );

    case 'listening':
      // Pulsing concentric ripple waves
      return (
        <span className="relative flex size-6 items-center justify-center">
          <motion.span
            className="absolute inset-0 rounded-full border-2 border-cobalt/50"
            animate={{ scale: [0.7, 1.5], opacity: [0.85, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.span
            className="absolute inset-1 rounded-full border border-citron"
            animate={{ scale: [0.8, 1.3], opacity: [0.9, 0] }}
            transition={{ duration: 1.1, delay: 0.35, repeat: Infinity, ease: 'easeOut' }}
          />
          <span className="size-2.5 rounded-full bg-tomato animate-pulse" />
        </span>
      );

    case 'streaming':
      // Fast typewriter glowing beam
      return (
        <span className="relative flex size-5 items-center justify-center">
          <motion.span
            className="h-4 w-1 rounded-pill bg-cobalt shadow-halo-cobalt"
            animate={{ opacity: [1, 0.2, 1], scaleY: [1, 0.6, 1] }}
            transition={{ duration: 0.45, repeat: Infinity, ease: 'easeInOut' }}
          />
        </span>
      );

    case 'warning':
      return (
        <motion.span
          className="size-3 rounded-full bg-tomato shadow-elevation-1"
          animate={{ scale: [1, 1.35, 1], opacity: [0.8, 1, 0.8] }}
          transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      );

    case 'thinking':
    default:
      // Fast morphing orbital triangle / tri-dot vortex
      return (
        <span className="relative flex size-6 items-center justify-center">
          <motion.div
            className="relative size-full flex items-center justify-center"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
          >
            {[0, 1, 2].map((i) => {
              const angle = (i * 2 * Math.PI) / 3;
              const r = 7;
              return (
                <motion.span
                  key={i}
                  className="absolute size-2 rounded-full"
                  style={{
                    backgroundColor: i === 1 ? 'rgb(var(--citron-rgb))' : 'rgb(var(--cobalt-rgb))',
                    top: `calc(50% - 4px + ${Math.sin(angle) * r}px)`,
                    left: `calc(50% - 4px + ${Math.cos(angle) * r}px)`,
                  }}
                  animate={{
                    scale: [0.8, 1.3, 0.8],
                  }}
                  transition={{
                    duration: 0.8,
                    repeat: Infinity,
                    delay: i * 0.22,
                    ease: 'easeInOut',
                  }}
                />
              );
            })}
          </motion.div>
        </span>
      );
  }
}

/**
 * Striking, compact ChatGPT-style Inline Activity Status:
 * Punchy procedural motion with instant spring transitions.
 */
export function ShinaActivityCapsule({
  state,
  detail,
  onCancel,
  onRetry,
  className,
}: ShinaActivityCapsuleProps) {
  const m = useMessages();
  const locale = useLocale();
  const prefersReduced = Boolean(useReducedMotion());
  const word = activityWordForState(state, locale);

  if (!word || state === 'idle') {
    return null;
  }

  const isWarning = state === 'warning';
  const abortable = isAbortableState(state);

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={state}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        initial={prefersReduced ? false : { opacity: 0, scale: 0.92, y: 3 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={prefersReduced ? undefined : { opacity: 0, scale: 0.95, y: -3 }}
        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          'inline-flex items-center gap-2.5 py-1 text-ink select-none',
          isWarning && 'text-tomato-ink',
          className,
        )}
      >
        {/* Kinetic High-Impact Action Glyph */}
        <div className="flex shrink-0 items-center justify-center">
          <ActionMotionGlyph state={state} reduced={prefersReduced} />
        </div>

        {/* Dynamic Status Word with Spring Transition */}
        <div className="flex items-center gap-2">
          <AnimatePresence mode="wait">
            <motion.span
              key={word}
              initial={prefersReduced ? false : { opacity: 0, x: locale === 'ar' ? 4 : -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={prefersReduced ? undefined : { opacity: 0, x: locale === 'ar' ? -4 : 4 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              className="font-display text-13 font-bold text-ink"
            >
              {word}
            </motion.span>
          </AnimatePresence>

          {detail && !isWarning && (
            <span className="hidden sm:inline-block max-w-[200px] truncate font-text text-11 text-stone/70">
              {detail}
            </span>
          )}
        </div>

        {/* Quick Stop Control */}
        {abortable && onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label={m.shinaCancelRequest}
            title={m.shinaCancelRequest}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-stone transition-all hover:bg-sand/30 hover:text-tomato focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cobalt active:scale-90"
          >
            <Icon name="stop" size={12} />
          </button>
        ) : null}

        {/* Quick Retry Control */}
        {isWarning && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            aria-label={m.shinaRetryAction}
            className="inline-flex items-center gap-1 text-12 font-bold text-tomato-ink hover:underline active:scale-95 transition-transform"
          >
            <Icon name="retry" size={12} />
            <span>{m.shinaRetryAction}</span>
          </button>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}
