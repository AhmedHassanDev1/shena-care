'use client';

import type { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';

/**
 * One motion policy for the storefront: visitors who ask for reduced motion keep opacity and colour changes but lose
 * every transform and layout animation (Motion's `reducedMotion="user"`), so no component needs its own check.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
