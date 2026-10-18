import * as React from "react"

import { cn } from "@/lib/utils"

export type MessageTone = "info" | "warn" | "ok" | "err"

const toneClass: Record<MessageTone, { box: string; dot: string }> = {
  info: { box: "bg-blue-tint", dot: "bg-blue" },
  warn: { box: "bg-saffron-tint", dot: "bg-warn" },
  ok: { box: "bg-ok-tint", dot: "bg-ok" },
  err: { box: "bg-err-tint", dot: "bg-err" },
}

export interface MessageBoxProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tone: MessageTone
  title?: React.ReactNode
}

/**
 * Message box (CommerceStates): radius 14, tinted ground, night text 14/22 and a tone dot — colour never carries the
 * meaning alone, the words do. `err` is announced immediately (role=alert); the others politely (role=status).
 */
export function MessageBox({ tone, title, className, children, role, ...props }: MessageBoxProps) {
  const t = toneClass[tone]
  return (
    <div
      role={role ?? (tone === "err" ? "alert" : "status")}
      className={cn("flex items-start gap-2.5 rounded-input px-3.5 py-3 text-14 leading-22 text-night", t.box, className)}
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
