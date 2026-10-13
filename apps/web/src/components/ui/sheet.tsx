"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Icon } from "./icon"
import { iconButtonVariants } from "./icon-button"

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close
const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn("fixed inset-0 z-overlay bg-scrim motion-safe:data-[state=open]:animate-fade-in", className)}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

/**
 * Sides are logical: `start`/`end` follow the document direction, so the same code opens from the
 * right in Arabic (RTL) and from the left in English (LTR) for `start`, and the reverse for `end`.
 */
const sheetVariants = cva(
  "fixed z-overlay flex flex-col gap-4 bg-popover p-6 text-popover-foreground shadow-sheet",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 rounded-b-lg border-b border-border motion-safe:data-[state=open]:animate-sheet-in-top",
        bottom:
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-lg border-t border-border motion-safe:data-[state=open]:animate-sheet-in-bottom",
        start:
          "inset-y-0 start-0 h-full w-[85%] max-w-sm border-e border-border motion-safe:data-[state=open]:animate-sheet-in-left rtl:motion-safe:data-[state=open]:animate-sheet-in-right",
        end: "inset-y-0 end-0 h-full w-[85%] max-w-sm border-s border-border motion-safe:data-[state=open]:animate-sheet-in-right rtl:motion-safe:data-[state=open]:animate-sheet-in-left",
      },
    },
    defaultVariants: {
      side: "end",
    },
  }
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** Accessible name of the close button. Pass a localized string. */
  closeLabel: string
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "end", className, children, closeLabel, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      <SheetPrimitive.Close className={cn(iconButtonVariants({ size: "s" }), "absolute end-3 top-3 text-muted-foreground")}>
        <Icon name="close" size={20} />
        <span className="sr-only">{closeLabel}</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 pe-8 text-start", className)} {...props} />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-title text-foreground", className)} {...props} />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-body-s text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
