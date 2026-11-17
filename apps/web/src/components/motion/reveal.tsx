'use client';

import type { ReactNode } from 'react';
import { motion } from 'motion/react';

/** Shared easing: the Sahel standard curve (tokens.app.json motion.ease.standard), as Motion's cubic-bezier array. */
export const EASE_STANDARD: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Scroll reveal for below-the-fold blocks: one short rise and fade the first time the block enters the viewport.
 * Never wrap first-screen content in it (it would delay the largest paint).
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      transition={{ duration: 0.55, delay, ease: EASE_STANDARD }}
    >
      {children}
    </motion.div>
  );
}
