import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon, type IconName } from '@/components/ui/icon';
import { Wordmark } from '@/components/ui/wordmark';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { formatNumber } from '@/lib/i18n/format';
import { fillMessage, getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes, shellRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Sahel Site Footer: Clean service strip on chalk ground + ink footer with chalk typography.
 */
export function SiteFooter({ services: showServices = true, dockClearance = false }: { services?: boolean; dockClearance?: boolean } = {}) {
  const locale = getLocale();
  const m = getMessages(locale);
  const services: Array<{ icon: IconName; title: string; body: string }> = [
    { icon: 'truck', title: m.serviceDelivery, body: m.serviceDeliveryBody },
    { icon: 'payment', title: m.servicePayment, body: m.servicePaymentBody },
    { icon: 'returns', title: m.serviceReturns, body: m.serviceReturnsBody },
    { icon: 'shield', title: m.serviceSource, body: m.serviceSourceBody },
  ];
  const columns: Array<{ title: string; items: Array<{ label: string; href?: string }> }> = [
    {
      title: m.footerShopTitle,
      items: [
        { label: m.navSkin, href: routes.productsByCategory(mainCategorySlugs.skin) },
        { label: m.navHair, href: routes.productsByCategory(mainCategorySlugs.hair) },
        { label: m.navBrands, href: routes.products },
      ],
    },
    {
      title: m.footerRoutinesTitle,
      items: [
        { label: m.navBuildRoutine, href: routes.routineBuilder },
        { label: m.footerMyRoutine, href: shellRoutes.routines },
        { label: m.footerAskShina, href: shellRoutes.shina },
      ],
    },
    {
      title: m.footerHelpTitle,
      items: [{ label: m.footerDelivery }, { label: m.footerReturns }, { label: m.footerContact }, { label: m.footerFaq }],
    },
  ];
  const linkClass = 'flex min-h-control-s items-center text-chalk/80 no-underline hover:text-chalk transition-colors';

  return (
    <>
      {showServices ? (
        <PageContainer>
          <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-6 px-0 pb-12 pt-8 border-t border-ink/14 lg:grid-cols-4 lg:gap-6 font-display">
            {services.map((s) => (
              <li key={s.title} className="flex items-start gap-3.5">
                <span className="hidden size-11 flex-none items-center justify-center rounded-full bg-sand text-ink lg:flex">
                  <Icon name={s.icon} size={22} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-16 font-semibold leading-tight text-ink">{s.title}</span>
                  <span className="text-14 leading-tight text-stone">{s.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </PageContainer>
      ) : null}

      <footer className={cn('bg-ink pb-nav-safe text-chalk font-display', dockClearance && 'max-lg:pb-24')}>
        <PageContainer className="flex flex-col gap-10 pb-8 pt-10 lg:pt-16">
          <div className="flex flex-wrap gap-x-16 gap-y-10 max-lg:hidden">
            <div className="flex flex-[1.4_1_300px] flex-col gap-3">
              <Wordmark size="footer" />
              <p className="m-0 max-w-narrow text-16 leading-relaxed text-chalk/80">{m.footerAbout}</p>
            </div>
            {columns.map((col) => (
              <nav key={col.title} aria-label={col.title} className="flex flex-[1_1_160px] flex-col text-15 leading-relaxed">
                <span className="text-13 font-semibold text-chalk mb-2">{col.title}</span>
                {col.items.map((item) =>
                  item.href ? (
                    <Link key={item.label} href={item.href} className={linkClass}>
                      {item.label}
                    </Link>
                  ) : (
                    <span key={item.label} className="flex min-h-control-s items-center text-chalk/80">
                      {item.label}
                    </span>
                  )
                )}
              </nav>
            ))}
          </div>

          {/* Phone */}
          <div className="flex flex-col gap-6 lg:hidden">
            <Wordmark size="footer" />
            <div className="grid grid-cols-2 gap-4">
              {[columns[0], { title: m.footerRoutinesHelpTitle, items: [columns[1].items[0], columns[1].items[1], columns[2].items[2]] }].map((col) => (
                <nav key={col.title} aria-label={col.title} className="flex flex-col text-15 leading-relaxed">
                  <span className="text-13 font-semibold text-chalk mb-2">{col.title}</span>
                  {col.items.map((item) =>
                    item.href ? (
                      <Link key={item.label} href={item.href} className={linkClass}>
                        {item.label}
                      </Link>
                    ) : (
                      <span key={item.label} className="flex min-h-control-s items-center text-chalk/80">
                        {item.label}
                      </span>
                    )
                  )}
                </nav>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-5 text-13 text-chalk/75 border-t border-chalk/14">
            <span>{fillMessage(m.footerCopyright, { year: formatNumber(new Date().getFullYear(), locale).replace(/[٬,]/g, '') })}</span>
            <span className="flex items-center gap-5">
              <span>{m.footerTerms}</span>
              <span>{m.footerPrivacy}</span>
              <LocaleSwitch tone="onNight" />
            </span>
          </div>
        </PageContainer>
      </footer>
    </>
  );
}
