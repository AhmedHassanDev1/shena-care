import Link from "next/link"

import { Wordmark, type WordmarkProps } from "@/components/ui/wordmark"
import { routes } from "@/lib/routes"
import { cn } from "@/lib/utils"

/**
 * The brand as a link home (header, footer, auth). `label` is the localized accessible name of the link.
 * `size="responsive"` shows the compact mark on phones/tablets and the full mark (with the Latin name)
 * from bp-desktop.
 */
export function WordmarkLink({
  label,
  size = "s",
  className,
  ...wordmark
}: Omit<WordmarkProps, "className" | "size"> & { label: string; size?: WordmarkProps["size"] | "responsive"; className?: string }) {
  return (
    <Link
      href={routes.home}
      aria-label={label}
      className={cn("inline-flex min-h-control-m items-center rounded-pill px-1", className)}
    >
      {size === "responsive" ? (
        <>
          <Wordmark size="s" className="lg:hidden" {...wordmark} />
          <Wordmark size="m" className="hidden lg:inline-flex" {...wordmark} />
        </>
      ) : (
        <Wordmark size={size} {...wordmark} />
      )}
    </Link>
  )
}
