'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'motion/react';
import { PageContainer } from '@/components/layout/page-container';
import { EASE_STANDARD } from '@/components/motion/reveal';
import { buttonVariants } from '@/components/ui/button-variants';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { useConcernShelf } from '../hooks/useConcernShelf';

const LINE = { hidden: { opacity: 0, y: 28 }, shown: { opacity: 1, y: 0 } };

/**
 * First screen. One orchestrated moment: the photograph settles, the headline lines rise in turn and the citron
 * highlighter is drawn under the promise. After that the hero is still. The concern dock under the headline reads the
 * live concern list, so the first thing a visitor can do is start from what bothers them.
 */
export function SahelHero() {
  const m = useMessages();
  const locale = useLocale();
  const shelf = useConcernShelf();
  const dock = [...shelf.concerns].sort((a, b) => b.productCount - a.productCount).slice(0, 5);

  return (
    <section aria-labelledby="home-hero-title" className="relative isolate w-full overflow-hidden bg-chalk text-ink">
      {/* Photograph: full bleed on desktop, a framed still life above the copy on phones. */}
      <motion.div
        className="absolute inset-0 -z-10 hidden lg:block"
        initial={{ scale: 1.06, opacity: 0.4 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.4, ease: EASE_STANDARD }}
      >
        <Image
          src="/assets/home/sahel-hero-desktop.webp"
          alt={m.sahelHeroAltDesktop}
          fill
          priority
          sizes="(min-width: 1024px) 1440px, 100vw"
          className="select-none object-cover object-start"
        />
      </motion.div>

      <div className="px-4 pt-3 md:px-6 lg:hidden">
        <div className="relative aspect-[5/4] w-full overflow-hidden rounded-sheet bg-sand shadow-elevation-1">
          <Image
            src="/assets/home/sahel-hero-mobile.webp"
            alt={m.sahelHeroAltMobile}
            fill
            priority
            sizes="(max-width: 1023px) 100vw, 540px"
            className="object-cover object-center"
          />
        </div>
      </div>

      <PageContainer className="flex flex-col gap-6 pb-8 pt-6 lg:min-h-[640px] lg:justify-center lg:pb-12 lg:pt-12 xl:min-h-[680px]">
        <motion.div
          className="flex max-w-xl flex-col items-start gap-5 text-start lg:max-w-[600px] lg:gap-6"
          initial="hidden"
          animate="shown"
          transition={{ staggerChildren: 0.1, delayChildren: 0.15 }}
        >
          <h1 id="home-hero-title" className="m-0 font-display text-display-hero font-extrabold tracking-tight text-ink">
            <motion.span variants={LINE} transition={{ duration: 0.7, ease: EASE_STANDARD }} className="block">
              {m.sahelHeroHeadlineStart}
            </motion.span>
            <motion.span variants={LINE} transition={{ duration: 0.7, ease: EASE_STANDARD }} className="relative mt-1 inline-block">
              <span className="relative z-10">{m.sahelHeroHeadlineAccent}</span>
              <motion.span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-1 z-0 h-3 origin-right rounded-4 bg-citron lg:bottom-2 lg:h-5"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.8, delay: 0.75, ease: EASE_STANDARD }}
              />
            </motion.span>
          </h1>

          <motion.p variants={LINE} transition={{ duration: 0.6, ease: EASE_STANDARD }} className="m-0 max-w-md text-body text-stone">
            {m.sahelHeroDescription}
          </motion.p>

          <motion.div variants={LINE} transition={{ duration: 0.6, ease: EASE_STANDARD }} className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Link href="#shop" className={buttonVariants({ variant: 'cobalt', size: 'l', className: 'w-full sm:w-auto' })}>
              <span>{m.sahelHeroPrimaryCta}</span>
              <Icon name="arrow-forward" size={18} strokeWidth={2.2} />
            </Link>
            <Link href={routes.routines} className={buttonVariants({ variant: 'ghost', size: 'l', className: 'w-full sm:w-auto' })}>
              {m.sahelHeroSecondaryCta}
            </Link>
          </motion.div>
          {/* Concern dock: the live shelf, busiest concern first. Hidden when the catalog has none (the atlas below says why). */}
          {shelf.isPending || dock.length > 0 ? (
            <motion.nav
              aria-label={m.homeConcernNavLabel}
              className="flex flex-col gap-3 border-t border-ink/15 pt-5"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.9, ease: EASE_STANDARD }}
            >
              <p className="m-0 font-display text-16 font-bold text-ink">{m.vxHeroDockTitle}</p>
              <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                {shelf.isPending
                  ? Array.from({ length: 5 }, (_, i) => (
                      <li key={i}>
                        <Skeleton className="h-control-m w-36 rounded-pill" />
                      </li>
                    ))
                  : dock.map((concern) => (
                      <li key={concern.slug}>
                        <Link
                          href={routes.cornerConcern(concern.slug)}
                          className="group inline-flex h-control-m items-center gap-2 rounded-pill bg-chalk px-4 font-display text-15 font-bold text-ink shadow-outline-hairline transition-[background-color,color,box-shadow] duration-fast hover:bg-cobalt hover:text-chalk hover:shadow-elevation-1"
                        >
                          <span>{concern.name}</span>
                          <span className="text-13 font-medium text-stone tabular-nums transition-colors duration-fast group-hover:text-chalk/80">
                            {fillMessage(m.vxProductsCount, { n: formatNumber(concern.productCount, locale) })}
                          </span>
                        </Link>
                      </li>
                    ))}
              </ul>
            </motion.nav>
          ) : null}
        </motion.div>

      </PageContainer>
    </section>
  );
}
