import { cva } from "class-variance-authority"

/**
 * SAHEL buttons (ShutterLoading board, SAHEL V2 §Components). Kept outside the "use client" module so server
 * components can style a link as a button.
 *
 * Colours: `bottle` buy/pay (the only commerce action), `ink` account/routine, `light` secondary (linen + 1.5px night
 * ring), `saffron` the assistant (never next to bottle), `text` underlined link. Every button is a pill; heights are the
 * board's 44 / 48 / 56. Disabled = sand fill + ink-3 text (never opacity). `success` and the async states are driven
 * by AsyncButton.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-pill font-text font-semibold no-underline",
    "transition-[background-color,box-shadow,transform,color] duration-fast ease-standard",
    "enabled:active:scale-[.97]",
    "disabled:cursor-not-allowed disabled:bg-sand disabled:text-ink-3 disabled:shadow-none",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        bottle: "bg-bottle text-white shadow-action hover:bg-bottle-hover active:bg-bottle-deep",
        ink: "bg-night text-linen hover:bg-night-2",
        light: "sl-light bg-linen text-night shadow-outline-night hover:bg-bone",
        saffron: "sl-light bg-saffron text-night hover:bg-saffron/90",
        /** Linen pill on a Sahel-bottle or night field (Home hero «تسوّق مختارات الخريف»). */
        onDark: "sl-light bg-linen text-night hover:bg-bone",
        text: "text-link h-auto rounded-none px-0 disabled:bg-transparent",
      },
      size: {
        s: "h-control-s px-4.5 text-14 leading-22",
        m: "h-control-m px-5.5 text-14 leading-22",
        l: "h-control-l px-5.5 text-16 leading-25",
        icon: "size-control-s p-0",
      },
      state: {
        idle: "",
        success: "bg-ok text-white shadow-none hover:bg-ok",
      },
    },
    compoundVariants: [{ variant: "text", className: "h-auto px-0" }],
    defaultVariants: { variant: "bottle", size: "l", state: "idle" },
  }
)
