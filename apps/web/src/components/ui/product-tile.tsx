"use client"

import * as React from "react"
import Image from "next/image"

import { canOptimizeImage } from "@/lib/images"
import { useMessages } from "@/lib/i18n/LocaleProvider"
import { fillMessage } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { Icon } from "./icon"

export interface ProductTileProps {
  /** Catalog image URL; null when the catalog has none (→ the labelled placeholder, never a generated pack). */
  src: string | null
  alt: string
  /** Product name for the placeholder's accessible label. */
  name: string
  /** `tile` 4:5 card/PDP tile; `thumb` small rows (cart, checkout, orders) with a compact placeholder. */
  size?: "tile" | "thumb"
  priority?: boolean
  sizes?: string
  className?: string
  children?: React.ReactNode
}

/**
 * The shared product stage (SAHEL V2 "every brand on one stage"; ProductCard board): every packshot sits on the same
 * sand tile (radius-image 12) with the same umber contact shadow, multiplied onto the tile so white packshot grounds
 * disappear. No image → dashed «صورة المنتج من الكتالوج» placeholder; broken image → «الصورة مش متاحة» (img-error).
 * `children` are overlays (e.g. «غير متوفر حاليًا»).
 */
export function ProductTile({ src, alt, name, size = "tile", priority, sizes, className, children }: ProductTileProps) {
  const m = useMessages()
  const [failed, setFailed] = React.useState(false)
  const imgRef = React.useRef<HTMLImageElement>(null)
  // An image that failed before hydration never fires onError: check once on mount.
  React.useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth === 0) setFailed(true)
  }, [src])
  const [line1, line2] = m.tilePending.split("|")
  const thumb = size === "thumb"

  return (
    <div className={cn("relative overflow-hidden rounded-image bg-sand", !thumb && "aspect-[4/5]", className)}>
      {src && !failed ? (
        <Image
            ref={imgRef}
            src={src}
            alt={alt}
            fill
            priority={priority}
            unoptimized={!canOptimizeImage(src)}
            sizes={sizes ?? (thumb ? "96px" : "(min-width: 1024px) 288px, 46vw")}
            onError={() => setFailed(true)}
            className="object-contain object-bottom p-[6%] pb-[4%] mix-blend-multiply"
          />
      ) : failed ? (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-12 font-medium leading-17 text-ink-2">
          <Icon name="image-off" size={thumb ? 20 : 28} />
          {thumb ? <span className="sr-only">{m.tileError}</span> : <span>{m.tileError}</span>}
        </span>
      ) : (
        <span
          role="img"
          aria-label={fillMessage(m.tilePendingLabel, { name })}
          className={cn(
            "absolute flex flex-col items-center justify-center gap-1.5 rounded-8 border border-dashed border-line-2 text-center font-semibold text-ink-3",
            thumb ? "inset-1.5 text-10.5 leading-13" : "inset-3 text-12 leading-16"
          )}
        >
          <Icon name="camera" size={thumb ? 16 : 22} />
          {thumb ? null : (
            <span>
              {line1}
              <br />
              {line2}
            </span>
          )}
        </span>
      )}
      {children}
    </div>
  )
}
