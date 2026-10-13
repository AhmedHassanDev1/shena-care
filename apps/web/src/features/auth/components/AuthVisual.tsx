import Image from 'next/image';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

/**
 * Sign-in shares Home's campaign photography (unbranded, editorial), so moving between the storefront and
 * sign-in feels like one product. Composed with the subject on the right; mirrored in RTL so she sits on the
 * end side, away from the wordmark and copy.
 */
const PHOTO = '/assets/home/routine-builder.webp';

/**
 * Compact introduction for phones: a short photographic band under the brand and language switch, washed from
 * the start side so the wordmark always reads, keeping the form the first thing the eye lands on. Decorative.
 */
export function AuthBand({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-atmosphere="rose" className={cn('relative isolate h-40 overflow-hidden rounded-b-[2rem] bg-atm-surface', className)}>
      <Image src={PHOTO} alt="" fill priority sizes="100vw" className="-z-10 object-cover object-right rtl:-scale-x-100" />
      <span className="absolute inset-0 -z-10 from-atm-wash from-25% via-atm-wash/60 via-45% to-transparent to-70% ltr:bg-gradient-to-r rtl:bg-gradient-to-l" />
    </div>
  );
}

/**
 * Editorial panel for desktop: the campaign portrait fills its upper two thirds and the three reasons to sign up sit on a
 * solid atmosphere scrim rising from the bottom, so their contrast never depends on the photograph.
 */
export function AuthPanel({ title, benefits }: { title: string; benefits: string[] }) {
  return (
    <aside data-atmosphere="rose" className="relative isolate hidden overflow-hidden rounded-lg bg-atm-surface lg:flex lg:flex-col lg:justify-end">
      {/* The upper two thirds: a tall panel would otherwise blow the 3:1 portrait up to a face close-up. */}
      <div className="absolute inset-x-0 top-0 -z-10 h-[64%]">
        <Image src={PHOTO} alt="" fill sizes="(min-width: 1024px) 55vw, 0px" className="object-cover object-[90%_30%] rtl:-scale-x-100" />
      </div>
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-atm-wash from-35% via-atm-wash/80 via-45% to-transparent to-60%" />

      <div className="grid gap-4 p-10 xl:p-14">
        <p className="text-label text-atm-ink">{title}</p>
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
    </aside>
  );
}
