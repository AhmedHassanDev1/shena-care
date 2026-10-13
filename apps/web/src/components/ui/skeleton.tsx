import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const skeletonVariants = cva("bg-sand-deep motion-safe:animate-pulse", {
  variants: {
    /** Match the final shape: rectangle for text blocks, pill for single lines, arch for product images. */
    shape: { rect: "rounded-sm", pill: "rounded-pill", arch: "shape-arch" },
  },
  defaultVariants: { shape: "rect" },
})

/** Loading placeholder that keeps the final layout. Decorative: announce loading separately (e.g. aria-busy on the region). */
function Skeleton({
  className,
  shape,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof skeletonVariants>) {
  return <div aria-hidden="true" className={cn(skeletonVariants({ shape }), className)} {...props} />
}

export { Skeleton }
