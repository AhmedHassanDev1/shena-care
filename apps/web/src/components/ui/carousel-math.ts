/**
 * Pure helpers for the scroll-snap carousel (no DOM), so direction handling is unit-tested.
 *
 * Browsers report `scrollLeft` as 0 at the start edge and NEGATIVE when scrolled toward the end in
 * right-to-left containers, and positive in left-to-right ones. Every slide is exactly one viewport wide.
 */

/** Index of the slide mostly in view for a given scroll offset. */
export function indexFromScroll(scrollLeft: number, slideWidth: number, count: number): number {
  if (slideWidth <= 0 || count <= 0) return 0;
  const index = Math.round(Math.abs(scrollLeft) / slideWidth);
  return Math.min(Math.max(index, 0), count - 1);
}

/** `scrollLeft` that aligns slide `index` with the start edge, for the container direction. */
export function scrollLeftForIndex(index: number, slideWidth: number, rtl: boolean): number {
  const offset = index * slideWidth;
  return offset === 0 ? 0 : rtl ? -offset : offset;
}

/** Previous/next with wrap-around, so the controls never dead-end. */
export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

/**
 * Slide step after a mouse drag of `dx` pixels (pointer end − start, screen axis). Content follows the pointer,
 * so the next slide is revealed by dragging toward the start side: left in LTR, right in RTL. Short drags
 * (under `threshold` of the slide width) settle back on the current slide.
 */
export function stepForDrag(dx: number, slideWidth: number, rtl: boolean, threshold = 0.15): -1 | 0 | 1 {
  if (slideWidth <= 0 || Math.abs(dx) < slideWidth * threshold) return 0;
  const towardRight = dx > 0;
  return towardRight === rtl ? 1 : -1;
}

/**
 * Arrow keys follow the VISUAL direction: in RTL, ArrowLeft moves toward the next slide.
 * Returns +1 (next), -1 (previous) or 0 (not a carousel key).
 */
export function stepForKey(key: string, rtl: boolean): -1 | 0 | 1 {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return 0;
  const leftIsNext = rtl;
  return (key === 'ArrowLeft') === leftIsNext ? 1 : -1;
}
