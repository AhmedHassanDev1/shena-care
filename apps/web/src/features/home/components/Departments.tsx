import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import type { Messages } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { HomeDepartment } from '../home-data';

/**
 * «تسوّق حسب القسم» (Main categories, Mobile horizontal rail): one campaign field per real catalog department —
 * skin on coral, hair on Sahel blue, any other on sand — with Beiruti title, the department's real child categories,
 * a «تسوّق» pill and the tilted photo slot. No licensed department photography exists, so the slot shows its labelled
 * placeholder «صورة القسم».
 */
const FIELD: Record<string, { box: string; button: string; slot: string; slotLine: string; warm: boolean }> = {
  'skin-care': { box: 'bg-coral text-night', button: 'bg-night text-linen', slot: 'bg-sand text-ink-3 shadow-elevation-2', slotLine: 'border-line-2', warm: true },
  'hair-care': { box: 'field-sahel text-linen', button: 'bg-linen text-night', slot: 'bg-linen/[.12] text-linen', slotLine: 'border-linen/70', warm: true },
};
const SAND = { box: 'bg-sand text-night', button: 'bg-blue text-white', slot: 'bg-linen/50 text-ink-3', slotLine: 'border-line-2', warm: false };

export function Departments({ m, departments }: { m: Messages; departments: HomeDepartment[] }) {
  if (!departments.length) return null;
  return (
    <section aria-labelledby="cat-h">
      <h2 id="cat-h" className="m-0 mb-5 text-display-2">
        {m.catTitle}
      </h2>
      <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 scrollbar-none lg:mx-0 lg:flex-wrap lg:gap-6 lg:overflow-visible lg:px-0 lg:pb-0">
        {departments.map((d) => {
          const f = FIELD[d.slug] ?? SAND;
          const title = d.slug === 'skin-care' ? m.navSkin : d.slug === 'hair-care' ? m.navHair : d.title;
          return (
            <Link
              key={d.slug}
              href={routes.productsByCategory(d.slug)}
              className={cn(
                'relative flex h-[224px] w-[250px] flex-none snap-start flex-col justify-between overflow-hidden rounded-card p-5 no-underline shadow-elevation-1 transition-transform duration-base ease-standard motion-safe:hover:-translate-y-[3px] lg:h-[280px] lg:w-auto lg:flex-[1_1_300px] lg:p-7',
                f.box,
                f.warm && 'shutter-light warm'
              )}
            >
              <span className="flex max-w-[180px] flex-col gap-1.5">
                <span className="text-12 font-semibold leading-17">{d.title}</span>
                <span className="font-display text-32 font-extrabold leading-36 lg:text-40 lg:leading-45">{title}</span>
                {d.sub ? <span className="hidden text-14 leading-22 lg:block">{d.sub}</span> : null}
              </span>
              <span className={cn('inline-flex h-control-s items-center gap-2 self-start rounded-pill px-4.5 text-14 font-semibold', f.button)}>
                <span>{m.catShop}</span>
                <Icon name="arrow-forward" size={16} />
              </span>
              <span
                aria-hidden="true"
                className={cn('absolute end-5 top-5 h-[125px] w-[92px] -rotate-3 overflow-hidden rounded-input lg:end-6.5 lg:top-7 lg:h-44 lg:w-[132px] ltr:rotate-3', f.slot)}
              >
                <span className={cn('absolute inset-2 flex flex-col items-center justify-center gap-1.5 rounded-8 border border-dashed text-center text-11 font-semibold leading-15', f.slotLine)}>
                  <Icon name="camera" size={20} />
                  {m.catPhoto}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
