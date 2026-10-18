import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import type { Messages } from '@/lib/i18n/messages';
import { routes, shellRoutes } from '@/lib/routes';

/**
 * Two entry cards (Main / Mobile after the routines): «ابني روتينك» on sand with the night CTA, and the Shina entry on
 * saffron-tint with the sun orb and the saffron «اسأل شينا» button (the assistant button never sits next to blue).
 * The routine showcase between picks and these entries needs a published-routines API that does not exist yet, so it
 * is not rendered (no fixtures).
 */
export function RoutineEntries({ m }: { m: Messages }) {
  const [t1, t2] = m.buildTitle.split('|');
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      <section aria-labelledby="build-h" className="flex flex-1 flex-col gap-4 rounded-sheet bg-sand p-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:px-7 lg:py-6">
        <div className="flex flex-col gap-1">
          <span className="text-12 font-semibold leading-17 text-ink-2">{m.buildEyebrow}</span>
          <h2 id="build-h" className="m-0 font-display text-26 font-bold leading-32 lg:text-28 lg:leading-34">
            {t1}
            <br />
            {t2}
          </h2>
          <p className="m-0 hidden text-14 leading-22 text-ink-2 lg:block">{m.buildBody}</p>
        </div>
        <Link
          href={routes.routineBuilder}
          className="inline-flex h-12.5 flex-none items-center justify-center gap-2.5 rounded-pill bg-night px-6 text-15 font-semibold text-linen no-underline hover:bg-night-2"
        >
          <span>{m.buildCta}</span>
          <Icon name="arrow-forward" size={18} />
        </Link>
      </section>

      <section aria-labelledby="shina-h" className="flex items-center gap-4 rounded-sheet bg-saffron-tint p-4 lg:w-[404px] lg:flex-none lg:px-6 lg:py-6">
        <span aria-hidden="true" className="sun-orb size-11 flex-none" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 id="shina-h" className="m-0 text-16 font-semibold leading-25 text-night">
            {m.shinaTitle}
          </h2>
          <p className="m-0 text-13 leading-20 text-saffron-ink">{m.shinaBody}</p>
        </div>
        <Link
          href={shellRoutes.shina}
          className="inline-flex h-11 flex-none items-center rounded-pill bg-saffron px-4.5 text-14 font-semibold text-night no-underline shadow-elevation-1 hover:bg-saffron/90"
        >
          {m.shinaCta}
        </Link>
      </section>
    </div>
  );
}
