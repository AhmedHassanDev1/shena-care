import Link from 'next/link';
import { Section, SectionHeader } from '@/components/layout/section';
import { ArrowLink } from '@/components/ui/arrow-link';
import { buttonVariants } from '@/components/ui/button-variants';
import { cardVariants } from '@/components/ui/card-variants';
import { Icon } from '@/components/ui/icon';
import { MediaFrame } from '@/components/ui/media-frame';
import { categoryLabel } from '@/features/catalog/lib/card-model';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage, getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes, shellRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { HOME_IMAGES, type HomeImage } from '../lib/home-images';
import { sectionNumber } from '../lib/section-number';

type Step = { slug: string; name: string };

const SKIN_STEPS: Step[] = [
  { slug: 'cleansers', name: 'Cleansers' },
  { slug: 'serums-treatments', name: 'Serums & Treatments' },
  { slug: 'moisturizers', name: 'Moisturizers' },
  { slug: 'sunscreens', name: 'Sunscreens' },
];
const HAIR_STEPS: Step[] = [
  { slug: 'shampoos', name: 'Shampoos' },
  { slug: 'conditioners', name: 'Conditioners' },
  { slug: 'hair-treatments-styling', name: 'Hair Treatments & Styling' },
];

/**
 * Routines (Stitch section 02): two cards, text on the reading side and a photograph on the other. A routine here is an
 * ordered list of the catalog's own categories; every step links to its category and nothing claims a product or result.
 * The photograph zooms slowly when the card is hovered.
 */
export function RoutineSection() {
  const locale = getLocale();
  const m = getMessages(locale);
  const routines: Array<{ id: string; meta: string; title: string; body: string; steps: Step[]; image: HomeImage }> = [
    {
      id: 'skin',
      meta: fillMessage(m.homeRoutineSkinMeta, { n: formatNumber(SKIN_STEPS.length, locale) }),
      title: m.homeRoutineSkinTitle,
      body: m.homeRoutineSkinBody,
      steps: SKIN_STEPS,
      image: HOME_IMAGES.routineSkin,
    },
    {
      id: 'hair',
      meta: fillMessage(m.homeRoutineHairMeta, { n: formatNumber(HAIR_STEPS.length, locale) }),
      title: m.homeRoutineHairTitle,
      body: m.homeRoutineHairBody,
      steps: HAIR_STEPS,
      image: HOME_IMAGES.routineHair,
    },
  ];

  return (
    <Section labelledBy="home-routine-title">
      <SectionHeader
        number={sectionNumber(2, locale)}
        title={m.homeRoutineTitle}
        titleId="home-routine-title"
        lead={m.homeRoutineBody}
        aside={<ArrowLink href={shellRoutes.routines}>{m.homeRoutinesAll}</ArrowLink>}
      />

      <ul className="m-0 grid list-none gap-3 p-0 lg:grid-cols-2 lg:gap-5">
        {routines.map((r) => (
          <li key={r.id}>
            <article className={cn(cardVariants({ interactive: true }), 'group flex h-full overflow-hidden')}>
              <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 lg:p-6">
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 text-12 font-medium leading-16 text-ink-2">
                    <span aria-hidden="true" className={cn('h-3 w-1.5 rounded-full', r.id === 'skin' ? 'bg-bottle' : 'bg-saffron')} />
                    {r.meta}
                  </span>
                  <h3 className="m-0 text-display-3 text-night">{r.title}</h3>
                  <p className="m-0 text-14 leading-22 text-ink-2">{r.body}</p>
                </div>

                <ol className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-0.5 p-0">
                  {r.steps.map((s, i) => (
                    <li key={s.slug}>
                      <Link
                        href={routes.productsByCategory(s.slug)}
                        className="flex min-h-9 items-center gap-2 text-13 font-medium leading-18 text-night no-underline transition-colors duration-fast ease-standard hover:text-bottle"
                      >
                        <span
                          aria-hidden="true"
                          className="flex size-5 flex-none items-center justify-center rounded-full bg-bone text-11 font-semibold leading-none text-ink-2 tabular-nums"
                        >
                          {formatNumber(i + 1, locale)}
                        </span>
                        {categoryLabel(s, locale) ?? s.name}
                      </Link>
                    </li>
                  ))}
                </ol>

                <ArrowLink href={routes.productsByCategory(r.steps[0].slug)} className="mt-auto self-start">
                  {m.homeRoutineStart}
                </ArrowLink>
              </div>

              <MediaFrame
                src={r.image.src}
                alt=""
                sizes="(min-width: 1024px) 240px, 144px"
                position={r.image.position}
                zoom
                className="w-28 flex-none sm:w-36 lg:w-60"
              />
            </article>
          </li>
        ))}
      </ul>

      <div className="flex justify-center">
        <Link href={shellRoutes.routines} className={buttonVariants({ variant: 'light', size: 'm' })}>
          {m.homeRoutineHub}
          <Icon name="arrow-forward" size={18} strokeWidth={2} />
        </Link>
      </div>
    </Section>
  );
}
