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
  <SheetPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-overlay bg-night/40 motion-safe:data-[state=open]:animate-fade-in", className)} {...props} />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

/**
 * SAHEL sheet: linen, radius-sheet (28) on the open edge, elevation-3 ("floating: sheets"). `bottom` is the phone
 * filter/sort sheet; `end` opens from the reading end (left in Arabic, right in English).
 */
const sheetVariants = cva("fixed z-overlay flex flex-col bg-linen text-night shadow-elevation-3", {
  variants: {
    side: {
      bottom: "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-sheet pb-safe motion-safe:data-[state=open]:animate-sheet-in-bottom",
      end: "inset-y-0 end-0 h-full w-[88%] max-w-[420px] rounded-s-sheet [--sheet-from:-100%] ltr:[--sheet-from:100%] motion-safe:data-[state=open]:animate-sheet-in-end",
    },
  },
  defaultVariants: { side: "bottom" },
})

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>, VariantProps<typeof sheetVariants> {
  /** Accessible name of the close button, localized. */
  closeLabel: string
}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side, className, children, closeLabel, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        <SheetPrimitive.Close className={cn(iconButtonVariants(), "absolute end-3 top-3")}>
          <Icon name="close" size={20} />
          <span className="sr-only">{closeLabel}</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
)
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1 px-5 pb-3 pe-14 pt-5 text-start", className)} {...props} />
)
const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mt-auto flex gap-3 border-t border-line px-4 pb-3 pt-3", className)} {...props} />
)

const SheetTitle = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Title>, React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>>(
  ({ className, ...props }, ref) => <SheetPrimitive.Title ref={ref} className={cn("m-0 text-display-3 text-night", className)} {...props} />
)
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => <SheetPrimitive.Description ref={ref} className={cn("m-0 text-14 leading-22 text-ink-2", className)} {...props} />)
SheetDescription.displayName = SheetPrimitive.Description.displayName

export { Sheet, SheetPortal, SheetOverlay, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
