export function clampIndex(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(count - 1, 0));
}
