import { ConcernGlyph } from '@/components/ui/concern-glyph';
import { Icon } from '@/components/ui/icon';
import { ProductArt } from '@/components/ui/product-art';
import { cn } from '@/lib/utils';

/** Soft blurred color fields: the "atmosphere" behind the composition. Decorative. */
function Fields() {
  return (
    <>
      <span className="absolute -start-24 -top-24 size-80 rounded-pill bg-rose/30 blur-3xl" />
      <span className="absolute -bottom-28 end-[-5rem] size-96 rounded-pill bg-lilac/35 blur-3xl" />
      <span className="absolute start-1/3 top-1/3 size-64 rounded-pill bg-peach/40 blur-3xl" />
    </>
  );
}

/**
 * Compact introduction for phones: a short blush-lilac-peach band with an arch and two silhouettes peeking in,
 * so the form stays the first thing the eye lands on. Decorative.
 */
export function AuthBand({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('relative isolate h-36 overflow-hidden rounded-b-[2rem] bg-gradient-to-br from-rose-soft via-lilac-soft to-peach-soft', className)}
    >
      <Fields />
      <span className="absolute bottom-0 end-8 h-[78%] w-24 shape-arch bg-card/55" />
      <ProductArt shape="dropper" tint="malachite" size={64} className="absolute bottom-0 end-11 h-auto w-14" />
      <ProductArt shape="jar" tint="henna" size={64} className="absolute -bottom-1 end-28 h-auto w-12" />
    </div>
  );
}

/**
 * Editorial panel for desktop: layered color fields, a large translucent arch holding three cosmetic
 * silhouettes (never shown as real products), floating concern glyphs, and the three reasons to sign up.
 */
export function AuthPanel({ title, benefits }: { title: string; benefits: string[] }) {
  return (
    <aside className="relative isolate hidden overflow-hidden rounded-lg bg-gradient-to-br from-rose-soft via-lilac-wash to-peach-soft lg:block">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <Fields />
      </div>

      <div className="relative z-10 grid gap-4 p-10 xl:p-14">
        <p className="text-label text-lilac-ink">{title}</p>
        <ul className="grid gap-3">
          {benefits.map((benefit) => (
            <li key={benefit} className="flex items-center gap-3 text-body-l text-foreground">
              <span aria-hidden="true" className="grid size-control-s shrink-0 place-items-center rounded-pill bg-card text-primary">
                <Icon name="check" size={18} />
              </span>
              {benefit}
            </li>
          ))}
        </ul>
      </div>

      <div aria-hidden="true" className="absolute inset-x-[12%] bottom-0 top-[40%]">
        <div className="absolute inset-0 shape-arch-l bg-card/45" />
        <div className="absolute inset-x-[14%] bottom-0 top-[16%] shape-arch-l bg-card/55" />
        <div className="absolute inset-x-[10%] bottom-[7%] flex items-end justify-center gap-[5%]">
          <ProductArt shape="jar" tint="henna" size={100} className="h-auto w-[24%] drop-shadow-[0_14px_18px_rgb(var(--ink-rgb)/0.14)]" />
          <ProductArt shape="dropper" tint="malachite" size={140} className="h-auto w-[34%] drop-shadow-[0_18px_22px_rgb(var(--ink-rgb)/0.16)]" />
          <ProductArt shape="pump" tint="saffron" size={120} className="h-auto w-[28%] drop-shadow-[0_14px_18px_rgb(var(--ink-rgb)/0.14)]" />
        </div>
      </div>

      {/* Floating concern glyphs: abstract, decorative. */}
      <div aria-hidden="true">
        {[
          { glyph: 'oily', x: '8%', y: '48%', size: 'size-14' },
          { glyph: 'acne', x: '78%', y: '44%', size: 'size-16' },
          { glyph: 'sensitive', x: '70%', y: '30%', size: 'size-12' },
        ].map(({ glyph, x, y, size }) => (
          <span
            key={glyph}
            style={{ insetInlineStart: x, insetBlockStart: y }}
            className={cn('absolute grid place-items-center rounded-pill bg-card text-lilac-ink shadow-float', size)}
          >
            <ConcernGlyph name={glyph as 'oily' | 'acne' | 'sensitive'} size={26} />
          </span>
        ))}
      </div>
    </aside>
  );
}
