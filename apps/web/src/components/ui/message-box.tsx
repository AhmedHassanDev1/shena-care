import * as React from "react"

import { cn } from "@/lib/utils"

export type MessageTone = "info" | "warn" | "ok" | "err"

const toneClass: Record<MessageTone, { box: string; dot: string }> = {
  info: { box: "bg-linen border border-ink/14", dot: "bg-cobalt" },
  warn: { box: "bg-dusk border border-dune", dot: "bg-warn" },
  ok: { box: "bg-ok-tint", dot: "bg-ok" },
  err: { box: "bg-conflict", dot: "bg-tomato" },
}

export interface MessageBoxProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tone: MessageTone
  title?: React.ReactNode
}

/**
 * Message box: radius-input (16px), tinted ground, ink text and tone dot.
 */
export function MessageBox({ tone, title, className, children, role, ...props }: MessageBoxProps) {
  const t = toneClass[tone]
  return (
    <div
      role={role ?? (tone === "err" ? "alert" : "status")}
      className={cn("flex items-start gap-2.5 rounded-input px-4 py-3 text-15 font-display leading-22 text-ink", t.box, className)}
      {...props}
    >
      <span aria-hidden="true" className={cn("mt-1.75 size-2 flex-none rounded-full", t.dot)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <p className="m-0 font-semibold">{title}</p> : null}
        {children}
      </div>
    </div>
  )
}
