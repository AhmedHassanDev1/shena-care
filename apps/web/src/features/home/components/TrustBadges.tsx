'use client';

import { PageContainer } from '@/components/layout/page-container';
import { Icon, type IconName } from '@/components/ui/icon';
import { useMessages } from '@/lib/i18n/LocaleProvider';

/**
 * Modern Beauty Editorial: Verified Trust Pillars
 * Concise, authentic statements backed by real business operations:
 * verified distribution, ingredient transparency, and reliable Cairo/Giza fulfillment.
 */
export function TrustBadges() {
  const m = useMessages();
  const items: Array<{ icon: IconName; title: string; body: string }> = [
    { icon: 'shield', title: m.homeTrustAuthTitle, body: m.homeTrustAuthBody },
    { icon: 'science', title: m.homeTrustFormulaTitle, body: m.homeTrustFormulaBody },
    { icon: 'truck', title: m.homeTrustClimateTitle, body: m.homeTrustClimateBody },
  ];

  return (
    <section aria-labelledby="home-trust-title" className="border-t border-line bg-linen/60 py-10 lg:py-14">
      <PageContainer>
        <h2 id="home-trust-title" className="sr-only">
          {m.homeTrustAuthTitle} · {m.homeTrustFormulaTitle} · {m.homeTrustClimateTitle}
        </h2>
        <ul className="m-0 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-3 sm:gap-8 lg:gap-12">
          {items.map((it) => (
            <li key={it.title} className="flex items-start gap-4">
              <span className="flex size-11 flex-none items-center justify-center rounded-full bg-sand text-ink">
                <Icon name={it.icon} size={20} />
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="m-0 font-display text-15 font-bold leading-22 text-ink lg:text-16">
                  {it.title}
                </h3>
                <p className="m-0 text-13 leading-20 text-stone lg:text-13.5 lg:leading-22">
                  {it.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </PageContainer>
    </section>
  );
}
