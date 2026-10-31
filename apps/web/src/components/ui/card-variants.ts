import { cva } from "class-variance-authority"

/**
 * The one card surface of the storefront: linen ground, hairline outline, radius-card. `interactive` adds the shared
 * hover (lift 2px, elevation-2) for cards that are links. Use this instead of re-spelling card classes in a page.
 * Kept outside "use client" so server components can use it.
 */
export const cardVariants = cva("rounded-card bg-linen text-ink shadow-outline-hairline", {
  variants: {
    interactive: {
      true: "no-underline transition-[transform,box-shadow] duration-base ease-standard hover:-translate-y-0.5 hover:shadow-e2",
      false: "",
    },
  },
  defaultVariants: { interactive: false },
})
