/** One answered unit: refused (with the words to show) or recorded (with the order as the server returned it, when it returned one). */
export interface UnitStep<T> { refusal: string | null; order: T | null }

export interface RegisterOutcome<T> {
  /** Units the server actually recorded. */
  done: number
  /** The newest order the server returned for a recorded unit: the only state it is safe to show. */
  last: T | null
  /** The words of the refusal that stopped the run, if the server refused a unit. */
  refusal: string | null
  /** A request failed (network / server error) before the run finished. */
  failed: boolean
  complete: boolean
}

/**
 * Records `count` units one after another through `registerOne` (the existing one-unit endpoint). It stops at the first unit that is refused
 * or fails and reports exactly how many the server recorded, so the screen never shows more progress than the server confirmed.
 */
export async function registerUnits<T>(count: number, registerOne: () => Promise<UnitStep<T> | undefined>): Promise<RegisterOutcome<T>> {
  let done = 0
  let last: T | null = null
  for (let i = 0; i < count; i++) {
    const step = await registerOne()
    if (!step) return { done, last, refusal: null, failed: true, complete: false }
    if (step.refusal !== null) return { done, last, refusal: step.refusal, failed: false, complete: false }
    done += 1
    if (step.order) last = step.order
  }
  return { done, last, refusal: null, failed: false, complete: true }
}
