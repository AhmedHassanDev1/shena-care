import { cva } from "class-variance-authority"

/**
 * ShinaCare · Sahel Buttons
 * Canonical specification from apps/web/docs/design-system/ShinaCare-Design-System-Sahel
 *
 * Rules:
 * - Every button is a pill (rounded-pill).
 * - Default button is Sahel Ink with Chalk text, shifting to Cobalt with lengthened shadow e2 on hover.
 * - Cobalt variant for direct CTA.
 * - Ghost variant uses 1.5px ink outline, inversing to ink on hover.
 * - Linen variant for soft surfaces.
 * - Tomato variant for special offers.
 * - Heights: 40px (xs) / 42px (s, m) / 54px (l); every call to action in the storefront uses one of them.
 * - States: hover lifts 1px and lengthens the shadow; pressed scales to .97; disabled is sand with stone text; busy
 *   (aria-busy) keeps its colour and shows the progress cursor; success is the ok fill; error is a tomato outline.
 * - Focus is drawn once, globally (globals.css), so every button shows the same ring.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-pill font-display font-semibold no-underline",
    "transition-[background-color,box-shadow,transform,color] duration-base ease-standard",
    "enabled:hover:-translate-y-px enabled:hover:shadow-elevation-2",
    "enabled:active:scale-[.97] enabled:active:translate-y-0",
    "disabled:cursor-not-allowed disabled:bg-sand disabled:text-stone disabled:shadow-none",
    "aria-busy:cursor-progress",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        ink: "bg-ink text-chalk shadow-elevation-1 hover:bg-cobalt active:bg-cobalt-deep",
        cobalt: "bg-cobalt text-chalk shadow-elevation-1 hover:bg-cobalt-deep active:bg-cobalt-deep",
        tomato: "bg-tomato text-ink shadow-elevation-1 hover:bg-tomato/90",
        ghost: "bg-transparent text-ink shadow-outline-ink hover:bg-ink hover:text-chalk hover:shadow-elevation-1",
        linen: "bg-linen text-ink shadow-elevation-1 hover:bg-linen/90",
        light: "bg-linen text-ink shadow-elevation-1 hover:bg-linen/90",
        saffron: "bg-citron text-ink shadow-elevation-1 hover:bg-citron/90",
        danger: "bg-tomato-ink text-chalk shadow-elevation-1 hover:bg-tomato-ink/90",
        onDark: "bg-linen text-ink shadow-elevation-1 hover:bg-linen/90",
        text: "text-link h-auto rounded-none px-0 shadow-none hover:shadow-none hover:translate-y-0 disabled:bg-transparent",
      },
      size: {
        xs: "h-control-s gap-1.5 px-4 text-14 leading-none",
        s: "h-control-m px-5 text-16 leading-none",
        m: "h-control-m px-6 text-17 leading-none",
        l: "h-control-l px-7.5 text-18 leading-none",
        icon: "size-control-m p-0",
      },
      state: {
        idle: "",
        success: "bg-ok text-white shadow-none hover:bg-ok",
        error: "bg-transparent text-tomato-ink shadow-outline-err hover:bg-conflict",
      },
    },
    compoundVariants: [{ variant: "text", className: "h-auto px-0 shadow-none hover:shadow-none" }],
    defaultVariants: { variant: "ink", size: "l", state: "idle" },
  }
)
