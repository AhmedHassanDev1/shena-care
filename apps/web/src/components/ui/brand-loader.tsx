import { cn } from "@/lib/utils"
import { Wordmark } from "./wordmark"

export interface BrandLoaderProps {
  /** Spoken and shown status («لحظات…»). */
  label: string
  className?: string
}

/**
 * The app-wide loading moment (not a skeleton): a simple 3D mark, one glossy Sahel citron sun bobbing on its shadow
 * with a cobalt comet circling it on a tilted ring, then the wordmark. Pure CSS, so it also works as a server
 * fallback. It fades in after a short delay, so a fast navigation never flashes it, and holds still for reduced motion.
 */
export function BrandLoader({ label, className }: BrandLoaderProps) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn("brand-loader-screen flex flex-col items-center gap-6 text-center", className)}>
      <div aria-hidden="true" className="brand-loader">
        <div className="brand-loader__tilt brand-loader__tilt--back">
          <span className="brand-loader__ring" />
        </div>
        <span className="brand-loader__sun" />
        <div className="brand-loader__tilt brand-loader__tilt--front">
          <span className="brand-loader__ring" />
        </div>
        <span className="brand-loader__shadow" />
      </div>
      <Wordmark />
      <p className="m-0 font-display text-15 font-medium text-stone">{label}</p>
    </div>
  )
}
