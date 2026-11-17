'use client';

import { useMemo } from 'react';
import { motion, useReducedMotion, type TargetAndTransition } from 'motion/react';
import { cn } from '@/lib/utils';
import type { ShinaActivityState } from '../lib/shina-types';

export interface ShinaOrbProps {
  state?: ShinaActivityState;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'hero';
  className?: string;
  interactive?: boolean;
}

const SIZE_CONFIG = {
  xs: { px: 28, core: 18, ringRadius: 13, ringStroke: 1.5, particleSize: 3 },
  sm: { px: 36, core: 24, ringRadius: 16, ringStroke: 1.75, particleSize: 3.5 },
  md: { px: 44, core: 30, ringRadius: 20, ringStroke: 2, particleSize: 4 },
  lg: { px: 56, core: 38, ringRadius: 25, ringStroke: 2.25, particleSize: 4.5 },
  hero: { px: 110, core: 76, ringRadius: 50, ringStroke: 3, particleSize: 7 },
};

/**
 * ShinaOrb — Living 3D-feeling Assistant Character for ShinaCare.
 *
 * Implements organic volumetric lighting, multi-layered depth, Fresnel edge glows,
 * procedural orbital rings, dynamic particle constellations, and state-driven
 * physics transformations mapped directly to ShinaCare activity states:
 *
 * - idle: Calm breathing, gentle 3D floating, subtle specular shimmer
 * - searching: Radial sweeps, energetic orbital expansion, scanning radar particles
 * - thinking: Elastic compression & expansion, counter-rotating translucent shells
 * - comparing: Multi-element orbiting satellites aligning and reorganizing
 * - routine: Sequential orbital nodes connecting step-by-step
 * - recommending: Warm radiant blooms, golden sparkle flares
 * - streaming: Rhythmic volumetric micro-pulses in sync with token arrival
 * - completed: Satisfying spring convergence and gentle relaxation
 * - warning: Controlled dampening, amber-tomato Fresnel shift
 * - listening: Concentric audio-reactive ripple fields
 */
export function ShinaOrb({
  state = 'idle',
  size = 'md',
  className,
  interactive = false,
}: ShinaOrbProps) {
  const prefersReduced = Boolean(useReducedMotion());
  const cfg = SIZE_CONFIG[size] || SIZE_CONFIG.md;

  const isIdle = state === 'idle';
  const isSearching = state === 'searching';
  const isThinking = state === 'thinking';
  const isComparing = state === 'comparing';
  const isRoutine = state === 'routine';
  const isRecommending = state === 'recommending';
  const isStreaming = state === 'streaming';
  const isCompleted = state === 'completed';
  const isWarning = state === 'warning';
  const isListening = state === 'listening';

  // Dynamic color palette based on operational state
  const palette = useMemo(() => {
    if (isWarning) {
      return {
        coreGradStart: 'rgba(235, 87, 87, 0.95)',
        coreGradMid: 'rgba(196, 40, 40, 0.85)',
        coreGradEnd: 'rgba(100, 15, 15, 0.95)',
        fresnel: 'rgba(255, 160, 140, 0.7)',
        halo: 'rgba(235, 87, 87, 0.25)',
        orbital: 'rgba(235, 87, 87, 0.6)',
        satellite1: 'rgba(245, 120, 100, 0.9)',
        satellite2: 'rgba(215, 50, 50, 0.8)',
      };
    }
    if (isRoutine || isRecommending) {
      return {
        coreGradStart: 'rgba(25, 95, 230, 0.95)',
        coreGradMid: 'rgba(230, 195, 70, 0.75)',
        coreGradEnd: 'rgba(10, 40, 120, 0.95)',
        fresnel: 'rgba(255, 225, 120, 0.8)',
        halo: 'rgba(230, 190, 60, 0.3)',
        orbital: 'rgba(230, 190, 50, 0.75)',
        satellite1: 'rgba(240, 205, 80, 0.95)',
        satellite2: 'rgba(20, 100, 240, 0.9)',
      };
    }
    // Default Shina Cobalt & Citron signature palette
    return {
      coreGradStart: 'rgba(30, 105, 240, 0.98)',
      coreGradMid: 'rgba(15, 60, 175, 0.9)',
      coreGradEnd: 'rgba(8, 25, 85, 0.98)',
      fresnel: 'rgba(160, 215, 255, 0.75)',
      halo: 'rgba(30, 105, 240, 0.28)',
      orbital: 'rgba(50, 130, 255, 0.65)',
      satellite1: 'rgba(240, 205, 80, 0.95)', // Citron droplet highlight
      satellite2: 'rgba(90, 165, 255, 0.85)',
    };
  }, [isWarning, isRoutine, isRecommending]);

  // Spring & morphing variants for the volumetric 3D core
  const coreAnim: TargetAndTransition = useMemo(() => {
    if (prefersReduced) {
      return { scale: 1, rotate: 0, y: 0 };
    }
    if (isThinking) {
      return {
        scale: [1, 1.08, 0.94, 1.04, 1],
        rotate: [0, -6, 6, -3, 0],
        y: [0, -3, 2, -1, 0],
        transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' as const },
      };
    }
    if (isSearching) {
      return {
        scale: [1, 1.05, 0.97, 1.03, 1],
        rotate: [0, 8, -8, 4, 0],
        y: [0, -4, 0, -2, 0],
        transition: { duration: 1.8, repeat: Infinity, ease: 'easeInOut' as const },
      };
    }
    if (isComparing) {
      return {
        scale: [1, 0.96, 1.04, 1],
        rotate: [-5, 5, -5],
        y: [0, -2, 0],
        transition: { duration: 2.0, repeat: Infinity, ease: 'easeInOut' as const },
      };
    }
    if (isRoutine) {
      return {
        scale: [1, 1.06, 0.98, 1],
        rotate: [0, 12, 0],
        y: [0, -3, 0],
        transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' as const },
      };
    }
    if (isStreaming) {
      return {
        scale: [1, 1.05, 1],
        y: [0, -1.5, 0],
        transition: { duration: 0.8, repeat: Infinity, ease: 'easeInOut' as const },
      };
    }
    if (isCompleted) {
      return {
        scale: [0.92, 1.1, 1],
        y: 0,
        rotate: 0,
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
      };
    }
    if (isWarning) {
      return {
        scale: [1, 0.96, 1],
        rotate: [-3, 3, -2, 2, 0],
        transition: { duration: 0.6, ease: 'easeInOut' as const },
      };
    }
    if (isListening) {
      return {
        scale: [1, 1.08, 0.98, 1.05, 1],
        y: [0, -2, 0],
        transition: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' as const },
      };
    }
    // Idle gentle breathing
    return {
      scale: [1, 1.03, 1],
      y: [0, -2.5, 0],
      rotate: [0, 1.5, 0, -1.5, 0],
      transition: { duration: 3.6, repeat: Infinity, ease: 'easeInOut' as const },
    };
  }, [
    prefersReduced,
    isThinking,
    isSearching,
    isComparing,
    isRoutine,
    isStreaming,
    isCompleted,
    isWarning,
    isListening,
  ]);

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center select-none',
        interactive && 'cursor-pointer transition-transform hover:scale-105 active:scale-95',
        className,
      )}
      style={{ width: cfg.px, height: cfg.px }}
      aria-hidden="true"
    >
      {/* 1. Volumetric Ambient Glow Halo */}
      <motion.div
        className="pointer-events-none absolute inset-[-25%] rounded-full blur-md"
        style={{ background: palette.halo }}
        animate={
          prefersReduced
            ? { opacity: 0.6 }
            : {
                opacity: isThinking || isSearching ? [0.4, 0.85, 0.4] : [0.35, 0.65, 0.35],
                scale: isThinking || isSearching ? [0.95, 1.15, 0.95] : [0.98, 1.05, 0.98],
              }
        }
        transition={{
          duration: isThinking || isSearching ? 1.6 : 3.2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* 2. Concentric Listening / Scanning Wavefronts */}
      {(isListening || isSearching) && !prefersReduced && (
        <>
          <motion.div
            className="pointer-events-none absolute inset-[-10%] rounded-full border border-cobalt/40"
            initial={{ scale: 0.8, opacity: 0.8 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
          />
          <motion.div
            className="pointer-events-none absolute inset-[-10%] rounded-full border border-citron/50"
            initial={{ scale: 0.8, opacity: 0.8 }}
            animate={{ scale: 1.65, opacity: 0 }}
            transition={{ duration: 1.8, delay: 0.6, repeat: Infinity, ease: 'easeOut' }}
          />
        </>
      )}

      {/* 3. Dynamic Orbital Rings (SVG 3D projection) */}
      <svg
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        viewBox={`0 0 ${cfg.px} ${cfg.px}`}
      >
        <defs>
          <linearGradient id={`orbGrad-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={palette.orbital} stopOpacity="0.85" />
            <stop offset="50%" stopColor={palette.orbital} stopOpacity="0.2" />
            <stop offset="100%" stopColor={palette.orbital} stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id={`citronRing-${size}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(240, 205, 80, 0.9)" />
            <stop offset="100%" stopColor="rgba(240, 205, 80, 0.1)" />
          </linearGradient>
        </defs>

        {/* Primary Elliptical Orbit (3D tilted) */}
        {!prefersReduced && (
          <motion.ellipse
            cx={cfg.px / 2}
            cy={cfg.px / 2}
            rx={cfg.ringRadius * 1.15}
            ry={cfg.ringRadius * 0.45}
            fill="none"
            stroke={`url(#orbGrad-${size})`}
            strokeWidth={cfg.ringStroke}
            strokeDasharray={isRoutine || isComparing ? '4 3' : 'none'}
            animate={{
              rotate: isSearching ? 360 : isThinking ? -360 : [0, 360],
            }}
            transition={{
              duration: isSearching ? 3 : isThinking ? 4.5 : 9,
              repeat: Infinity,
              ease: 'linear',
            }}
            style={{ originX: '50%', originY: '50%' }}
          />
        )}

        {/* Secondary Cross Orbit for Routine & Compare states */}
        {(isRoutine || isComparing || isSearching) && !prefersReduced && (
          <motion.ellipse
            cx={cfg.px / 2}
            cy={cfg.px / 2}
            rx={cfg.ringRadius * 1.05}
            ry={cfg.ringRadius * 0.4}
            fill="none"
            stroke={`url(#citronRing-${size})`}
            strokeWidth={cfg.ringStroke * 0.8}
            animate={{
              rotate: [-360, 0],
            }}
            transition={{
              duration: 5,
              repeat: Infinity,
              ease: 'linear',
            }}
            style={{ originX: '50%', originY: '50%', transform: 'rotate(60deg)' }}
          />
        )}
      </svg>

      {/* 4. Core Volumetric 3D Droplet Character */}
      <motion.div
        animate={coreAnim}
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: cfg.core,
          height: cfg.core,
          background: `radial-gradient(circle at 35% 28%, ${palette.coreGradStart} 0%, ${palette.coreGradMid} 52%, ${palette.coreGradEnd} 100%)`,
          boxShadow: `
            inset 0 2px 4px rgba(255, 255, 255, 0.45),
            inset -2px -3px 6px rgba(0, 10, 40, 0.65),
            0 4px 12px rgba(10, 35, 90, 0.28)
          `,
        }}
      >
        {/* Organic Shimmer Layer inside core */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(circle at 72% 75%, rgba(240, 205, 80, 0.28) 0%, transparent 48%)',
          }}
        />

        {/* Top-Left 3D Specular Highlight (creates droplet gloss) */}
        <div
          className="pointer-events-none absolute top-1.5 start-2 rounded-full"
          style={{
            width: Math.max(4, cfg.core * 0.28),
            height: Math.max(3, cfg.core * 0.16),
            background:
              'linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.2) 100%)',
            transform: 'rotate(-25deg)',
            filter: 'blur(0.5px)',
          }}
        />

        {/* Secondary Pin-point Specular Sparkle */}
        <div
          className="pointer-events-none absolute top-3 start-4 rounded-full bg-chalk/90"
          style={{
            width: Math.max(2, cfg.core * 0.08),
            height: Math.max(2, cfg.core * 0.08),
          }}
        />

        {/* 3D Fresnel Rim Light along lower edge */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            boxShadow: `inset 0 -2px 5px ${palette.fresnel}`,
          }}
        />

        {/* Iconic Citron Swirl Accent (Faithful to Shina mascot emblem) */}
        <motion.div
          className="pointer-events-none absolute -bottom-0.5 -end-0.5 rounded-full"
          style={{
            width: Math.max(5, cfg.core * 0.32),
            height: Math.max(5, cfg.core * 0.32),
            background:
              'radial-gradient(circle at 35% 35%, rgba(255, 235, 120, 1) 0%, rgba(225, 180, 40, 0.95) 75%)',
            boxShadow: '0 2px 5px rgba(180, 130, 20, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.8)',
          }}
          animate={
            prefersReduced
              ? undefined
              : {
                  scale: isThinking || isRoutine ? [1, 1.2, 0.95, 1] : [1, 1.08, 1],
                  rotate: isSearching ? [0, 360] : [0, 15, 0],
                }
          }
          transition={{
            duration: isSearching ? 2.5 : 3.0,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </motion.div>

      {/* 5. Orbiting Satellites (Particle Constellations) */}
      {!prefersReduced && (isSearching || isComparing || isRoutine || isThinking) && (
        <>
          {/* Satellite 1: Citron Particle */}
          <motion.div
            className="pointer-events-none absolute rounded-full shadow-elevation-1"
            style={{
              width: cfg.particleSize,
              height: cfg.particleSize,
              background: palette.satellite1,
              boxShadow: '0 0 6px rgba(240, 205, 80, 0.8)',
            }}
            animate={{
              x: [
                Math.cos(0) * cfg.ringRadius * 1.15,
                Math.cos(Math.PI * 0.6) * cfg.ringRadius * 1.15,
                Math.cos(Math.PI * 1.2) * cfg.ringRadius * 1.15,
                Math.cos(Math.PI * 1.8) * cfg.ringRadius * 1.15,
                Math.cos(Math.PI * 2) * cfg.ringRadius * 1.15,
              ],
              y: [
                Math.sin(0) * cfg.ringRadius * 0.45,
                Math.sin(Math.PI * 0.6) * cfg.ringRadius * 0.45,
                Math.sin(Math.PI * 1.2) * cfg.ringRadius * 0.45,
                Math.sin(Math.PI * 1.8) * cfg.ringRadius * 0.45,
                Math.sin(Math.PI * 2) * cfg.ringRadius * 0.45,
              ],
              scale: [1, 1.3, 0.8, 1.2, 1],
            }}
            transition={{
              duration: isSearching ? 2.2 : isThinking ? 3.0 : 4.0,
              repeat: Infinity,
              ease: 'linear',
            }}
          />

          {/* Satellite 2: Cobalt Sparkle Particle (Opposite Phase) */}
          {(isComparing || isRoutine) && (
            <motion.div
              className="pointer-events-none absolute rounded-full shadow-elevation-1"
              style={{
                width: cfg.particleSize * 0.85,
                height: cfg.particleSize * 0.85,
                background: palette.satellite2,
                boxShadow: '0 0 6px rgba(50, 130, 255, 0.8)',
              }}
              animate={{
                x: [
                  Math.cos(Math.PI) * cfg.ringRadius * 1.1,
                  Math.cos(Math.PI * 1.6) * cfg.ringRadius * 1.1,
                  Math.cos(Math.PI * 2.2) * cfg.ringRadius * 1.1,
                  Math.cos(Math.PI * 2.8) * cfg.ringRadius * 1.1,
                  Math.cos(Math.PI * 3) * cfg.ringRadius * 1.1,
                ],
                y: [
                  Math.sin(Math.PI) * cfg.ringRadius * 0.4,
                  Math.sin(Math.PI * 1.6) * cfg.ringRadius * 0.4,
                  Math.sin(Math.PI * 2.2) * cfg.ringRadius * 0.4,
                  Math.sin(Math.PI * 2.8) * cfg.ringRadius * 0.4,
                  Math.sin(Math.PI * 3) * cfg.ringRadius * 0.4,
                ],
              }}
              transition={{
                duration: isComparing ? 2.5 : 3.6,
                repeat: Infinity,
                ease: 'linear',
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
