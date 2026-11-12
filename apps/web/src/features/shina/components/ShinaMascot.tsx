'use client';

import Image from 'next/image';
import { motion, useReducedMotion, type TargetAndTransition } from 'motion/react';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import type { ShinaActivityState } from '../lib/shina-types';

export interface ShinaMascotProps {
  state?: ShinaActivityState;
  size?: 'xs' | 'sm' | 'md' | 'hero';
  alt?: string;
  decorative?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<ShinaMascotProps['size']>, string> = {
  xs: 'size-9',
  sm: 'size-10',
  md: 'size-12',
  hero: 'size-20 sm:size-28',
};

const IMAGE_SIZES: Record<NonNullable<ShinaMascotProps['size']>, number> = {
  xs: 36,
  sm: 40,
  md: 48,
  hero: 112,
};

function stateMotionAnimate(state: ShinaActivityState, reducedMotion: boolean): TargetAndTransition {
  if (reducedMotion) {
    return { y: 0, rotate: 0, scale: 1 };
  }
  switch (state) {
    case 'thinking':
      return {
        y: [0, -3, 0],
        rotate: [0, -2.5, 2.5, 0],
        scale: [1, 1.03, 1],
      };
    case 'searching':
      return {
        rotate: [-4, 4, -4],
        scale: [1, 1.04, 1],
      };
    case 'comparing':
      return {
        rotate: [-5, 5, -5],
        y: [0, -1.5, 0],
      };
    case 'routine':
      return {
        y: [0, -4, 0],
        scale: [1, 1.04, 1],
      };
    case 'recommending':
      return {
        y: [0, -3, 0],
        scale: [1, 1.06, 1],
      };
    case 'streaming':
      return {
        scale: [1, 1.045, 1],
        rotate: [0, 1.5, 0],
      };
    case 'clarification':
      return {
        rotate: -6,
        y: [0, -1.5, 0],
      };
    case 'completed':
      return {
        scale: [0.94, 1.06, 1],
        y: 0,
        rotate: 0,
      };
    case 'warning':
      return {
        x: [0, -2, 2, -1, 0],
      };
    case 'listening':
      return {
        scale: [1, 1.05, 1],
        y: [0, -2, 0],
      };
    default:
      return {
        y: [0, -2.5, 0],
      };
  }
}

function stateMotionDuration(state: ShinaActivityState): number {
  switch (state) {
    case 'warning':
    case 'completed':
      return 0.45;
    case 'streaming':
    case 'listening':
      return 1.3;
    case 'searching':
    case 'comparing':
    case 'thinking':
      return 2.0;
    default:
      return 3.2;
  }
}

export function ShinaMascot({
  state = 'idle',
  size = 'sm',
  alt = 'Shina beauty & routine mascot',
  decorative = false,
  className,
}: ShinaMascotProps) {
  const prefersReducedMotion = Boolean(useReducedMotion());
  const px = IMAGE_SIZES[size];
  const isLooping = state !== 'completed' && state !== 'warning';
  const badgeSmall = size === 'xs' || size === 'sm';

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center select-none',
        SIZE_CLASSES[size],
        className,
      )}
      aria-hidden={decorative ? 'true' : undefined}
    >
      {/* Ambient SAHEL Citron / Cobalt Glow */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute -inset-1 rounded-full transition-opacity duration-base',
          state === 'warning'
            ? 'bg-tomato/20 opacity-90'
            : state === 'listening'
              ? 'bg-cobalt/20 opacity-100'
              : 'shina-mascot-halo opacity-85',
        )}
      />

      {/* Voice Listening Ripples (strictly real SpeechRecognition active state) */}
      {state === 'listening' && !prefersReducedMotion ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full border-2 border-cobalt/45 shina-radar-spin"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-1.5 rounded-full border border-cobalt/35 shina-ripple"
          />
        </>
      ) : null}

      {/* Searching / Comparing Orbital Ring */}
      {(state === 'searching' || state === 'comparing' || state === 'routine') && !prefersReducedMotion ? (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute -inset-0.5 rounded-full border border-dashed shina-radar-spin',
            state === 'routine' ? 'border-citron/90' : 'border-cobalt/55',
          )}
        />
      ) : null}

      {/* Core Glossy Cobalt Droplet + Citron Ribbon Character Asset */}
      <motion.div
        animate={stateMotionAnimate(state, prefersReducedMotion)}
        transition={{
          duration: stateMotionDuration(state),
          repeat: isLooping && !prefersReducedMotion ? Infinity : 0,
          ease: 'easeInOut',
        }}
        className={cn(
          'relative flex size-full items-center justify-center rounded-full',
          size === 'hero' ? 'p-1' : 'p-0.5',
        )}
      >
        <Image
          src="/images/shina/shina-mascot.webp"
          alt={alt}
          width={px}
          height={px}
          priority={size === 'hero'}
          sizes={`${px}px`}
          className={cn(
            'size-full object-contain sahel-packshot-shadow',
            state === 'warning' && 'opacity-90 saturate-75',
          )}
        />
      </motion.div>

      {/* Micro State Badges */}
      {state === 'completed' ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -bottom-0.5 -end-0.5 flex items-center justify-center rounded-full bg-ok text-chalk shadow-elevation-1 ring-2 ring-chalk',
            badgeSmall ? 'size-4' : 'size-6',
          )}
        >
          <Icon name="check" size={badgeSmall ? 10 : 14} strokeWidth={2.4} />
        </span>
      ) : null}

      {state === 'clarification' ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -top-0.5 -end-0.5 flex items-center justify-center rounded-full border border-cobalt/30 bg-linen font-display font-bold text-cobalt shadow-elevation-1',
            badgeSmall ? 'size-4 text-11' : 'size-6 text-12',
          )}
        >
          ؟
        </span>
      ) : null}

      {state === 'warning' ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -top-0.5 -end-0.5 flex items-center justify-center rounded-full bg-tomato text-chalk shadow-elevation-1 ring-2 ring-chalk',
            badgeSmall ? 'size-4' : 'size-6',
          )}
        >
          <Icon name="alert" size={badgeSmall ? 10 : 14} strokeWidth={2.2} />
        </span>
      ) : null}
    </div>
  );
}
