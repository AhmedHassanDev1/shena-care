'use client';

import { useEffect, useState } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { A11y, Keyboard } from 'swiper/modules';
import { Section } from '@/components/layout/section';
import { Icon } from '@/components/ui/icon';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import type { ProductDetail } from '../api/discovery';
import { useRelatedProducts } from '../hooks/useRelatedProducts';
import { toCardModel } from '../lib/card-model';
import { ProductCard } from './ProductCard';

/**
 * Editorial "منتجات مشابهة" section placed below Customer Reviews.
 * Reuses the storefront ProductCard design with real discovery products only,
 * hides cleanly when zero genuine matches exist, and mounts only the active
 * desktop grid or mobile carousel to avoid hidden duplicate images and links.
 */
export function SimilarProducts({ product }: { product: ProductDetail }) {
  const locale = useLocale();
  const m = useMessages();
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const { data: items, isPending, isError } = useRelatedProducts(product, 8);

  if (isPending || isError || !items || items.length === 0) {
    return null;
  }

  const cards = items.map((item) => toCardModel(item, locale, m.sizeOr));
  const desktopCards = cards.slice(0, 4);
  const headingId = `pdp-similar-${product.id}`;

  return (
    <Section
      id={`similar-${product.id}`}
      labelledBy={headingId}
      rhythm="compact"
      className="py-2.5 lg:py-4"
    >
      <div className="mx-auto flex w-full max-w-[1140px] flex-col gap-3.5 border-t border-line pt-4 lg:pt-5">
        <div className="flex items-center gap-2 text-ink">
          <Icon name="sparkles" size={18} className="text-cobalt shrink-0" />
          <h2
            id={headingId}
            className="m-0 font-display text-19 sm:text-20 font-bold text-ink"
          >
            {m.pdpSimilarTitle}
          </h2>
        </div>

        {!mounted ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            {desktopCards.map((card, idx) => (
              <ProductCard key={card.id} product={card} priority={idx < 2} />
            ))}
          </div>
        ) : isDesktop ? (
          <div className="grid grid-cols-4 gap-4">
            {desktopCards.map((card, idx) => (
              <ProductCard key={card.id} product={card} priority={idx < 2} />
            ))}
          </div>
        ) : (
          <Swiper
            key={`similar-swiper-${product.id}-${locale}`}
            modules={[A11y, Keyboard]}
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            grabCursor={true}
            watchOverflow={true}
            keyboard={{ enabled: true }}
            className="w-full overflow-hidden py-1"
            breakpoints={{
              320: {
                slidesPerView: 1.42,
                spaceBetween: 12,
              },
              480: {
                slidesPerView: 2.1,
                spaceBetween: 12,
              },
              768: {
                slidesPerView: 3.1,
                spaceBetween: 14,
              },
            }}
          >
            {cards.map((card, idx) => (
              <SwiperSlide key={card.id} className="h-auto">
                <ProductCard product={card} priority={idx < 2} />
              </SwiperSlide>
            ))}
          </Swiper>
        )}
      </div>
    </Section>
  );
}
