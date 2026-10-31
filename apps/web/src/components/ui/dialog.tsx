"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"
import { iconButtonVariants } from "./icon-button"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-overlay bg-ink/35 backdrop-blur-[2px] motion-safe:data-[state=open]:animate-fade-in", className)} {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

interface DialogContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Accessible name of the close button, localized. Omit to hide the ✕ (decision dialogs answer with their buttons). */
  closeLabel?: string
}

/** Confirm dialog: linen, radius-sheet, elevation-3 (shadow-e3), centred with symmetric insets. */
const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  ({ className, children, closeLabel, ...props }, ref) => (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed inset-x-4 top-1/2 z-overlay mx-auto flex max-h-[calc(100dvh-2rem)] max-w-[480px] -translate-y-1/2 flex-col gap-4 overflow-y-auto",
          "rounded-card bg-linen p-6 text-ink shadow-e3 motion-safe:data-[state=open]:animate-rise-in",
          className
        )}
        {...props}
      >
        {children}
        {closeLabel ? (
          <DialogPrimitive.Close className={cn(iconButtonVariants(), "absolute end-3 top-3")}>
            <Icon name="close" size={20} />
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
)
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 pe-10 text-start", className)} {...props} />
)
const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-2.5 sm:flex-row", className)} {...props} />
)

const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  ({ className, ...props }, ref) => <DialogPrimitive.Title ref={ref} className={cn("m-0 text-display-3 text-ink font-display", className)} {...props} />
)
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => <DialogPrimitive.Description ref={ref} className={cn("m-0 text-16 leading-26 text-stone font-display", className)} {...props} />)
DialogDescription.displayName = DialogPrimitive.Description.displayName

export { Dialog, DialogPortal, DialogOverlay, DialogClose, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription }
