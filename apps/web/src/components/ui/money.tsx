"use client"

import { currencyLabel, formatAmount } from "@/lib/i18n/format"
import { useLocale } from "@/lib/i18n/LocaleProvider"
import { cn } from "@/lib/utils"

export interface MoneyProps {
  /** Amount in EGP as the API returns it (never formatted, never recomputed here). */
  amount: number
  /** Struck-through previous amount (CommerceStates §١ price changed, §٣ fee changed). */
  struck?: boolean
  className?: string
  /** Classes for the «ج.م» / "EGP" label (boards: 0.72em, 500, ink-2). */
  currencyClassName?: string
}

/**
 * An amount as the commerce boards set it (CartD, CheckoutD): the number in the interface digits with «ج.م» after it,
 * smaller and quieter. Display only — totals always come from the server.
 */
export function Money({ amount, struck, className, currencyClassName }: MoneyProps) {
  const locale = useLocale()
  return (
    <bdi className={cn("whitespace-nowrap tabular-nums", struck && "line-through decoration-1", className)}>
      {locale === "en" ? (
        <>
          <span className={cn("me-1 money-unit font-medium text-ink-2", currencyClassName)}>{currencyLabel(locale)}</span>
          {formatAmount(amount, locale)}
        </>
      ) : (
        <>
          {formatAmount(amount, locale)}
          <span className={cn("ms-[3px] money-unit font-medium text-ink-2", currencyClassName)}>{currencyLabel(locale)}</span>
        </>
      )}
    </bdi>
  )
}
