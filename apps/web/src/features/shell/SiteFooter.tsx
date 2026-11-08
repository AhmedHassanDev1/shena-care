import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { Icon, type IconName } from '@/components/ui/icon';
import { LocaleSwitch } from '@/components/LocaleSwitch';
import { formatNumber } from '@/lib/i18n/format';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { mainCategorySlugs, routes, shellRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

interface NavLinkItem {
  label: string;
  href: string;
  hasSunDot?: boolean;
}

interface NavColumn {
  titleAr: string;
  titleSubtitle: string;
  items: NavLinkItem[];
}

/**
 * Sahel Site Footer — Authentic Editorial Closing
 * Faithful implementation of approved Stitch project (8173867776074280858):
 * - Warm linen ground (`bg-linen`) with refined ink typography
 * - Distinctive brand identity with Beiruti wordmark, Citron sun dot, and Latin editorial campaign
 * - Direct consultation assistant banner ("اسألي مساعدة الجمال شينا")
 * - 4 distinct navigation columns (Shop, Discover, Account, Support)
 * - Restrained editorial social links and legal credits
 */
export function SiteFooter({
  services: showServices = false,
  dockClearance = false,
}: {
  services?: boolean;
  dockClearance?: boolean;
} = {}) {
  const locale = getLocale();
  const m = getMessages(locale);
  const currentYear = formatNumber(new Date().getFullYear(), locale).replace(/[٬,]/g, '');

  const servicesList: Array<{ icon: IconName; title: string; body: string }> = [
    { icon: 'truck', title: m.serviceDelivery, body: m.serviceDeliveryBody },
    { icon: 'payment', title: m.servicePayment, body: m.servicePaymentBody },
    { icon: 'returns', title: m.serviceReturns, body: m.serviceReturnsBody },
    { icon: 'shield', title: m.serviceSource, body: m.serviceSourceBody },
  ];

  const columns: NavColumn[] = [
    {
      titleAr: m.footerShop,
      titleSubtitle: m.footerShopSubtitle,
      items: [
        { label: m.navSkin, href: routes.productsByCategory(mainCategorySlugs.skin) },
        { label: m.navHair, href: routes.productsByCategory(mainCategorySlugs.hair) },
        { label: m.navBrands, href: routes.products },
      ],
    },
    {
      titleAr: m.footerRoutines,
      titleSubtitle: m.footerDiscoverSubtitle,
      items: [
        { label: m.footerRoutines, href: shellRoutes.routines },
        { label: m.footerAskShina, href: shellRoutes.shina, hasSunDot: true },
        { label: m.footerByNeed, href: routes.products },
      ],
    },
    {
      titleAr: m.footerAccount,
      titleSubtitle: m.footerAccountSubtitle,
      items: [
        { label: m.homeNavAccount, href: routes.account },
        { label: m.myOrdersTitle, href: routes.myOrders },
        { label: m.footerTrackOrder, href: routes.myOrders },
      ],
    },
    {
      titleAr: m.footerHelpTitle,
      titleSubtitle: m.footerSupportSubtitle,
      items: [
        { label: m.footerContact, href: '/support/contact' },
        { label: m.footerReturnsExchange, href: '/support/returns' },
        { label: m.footerPrivacy, href: '/legal/privacy' },
        { label: m.footerTerms, href: '/legal/terms' },
      ],
    },
  ];

  const socialLinks = [
    { label: m.footerInstagram, href: 'https://instagram.com' },
    { label: m.footerFacebook, href: 'https://facebook.com' },
    { label: m.footerTikTok, href: 'https://tiktok.com' },
  ];

  return (
    <>
      {showServices ? (
        <section aria-label="Customer service pillars" className="border-t border-line bg-chalk py-8 lg:py-12">
          <PageContainer>
            <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-6 p-0 md:grid-cols-4 md:gap-6 font-display">
              {servicesList.map((s) => (
                <li key={s.title} className="flex items-start gap-3">
                  <span className="flex size-10 flex-none items-center justify-center rounded-full bg-sand text-ink">
                    <Icon name={s.icon} size={20} />
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-15 font-semibold text-ink">{s.title}</span>
                    <span className="text-13 leading-18 text-stone">{s.body}</span>
                  </div>
                </li>
              ))}
            </ul>
          </PageContainer>
        </section>
      ) : null}

      <footer
        role="contentinfo"
        className={cn(
          'w-full border-t border-line bg-linen text-ink transition-colors',
          dockClearance && 'max-lg:pb-24'
        )}
      >
        <PageContainer className="pt-12 pb-10 lg:pt-18 lg:pb-14 flex flex-col gap-12">
          {/* Main Footer Editorial Grid */}
          <div className="grid grid-cols-1 gap-10 pb-12 border-b border-line lg:grid-cols-12 lg:gap-14">
            {/* Brand Identity & Consultation Column (4 cols in desktop) */}
            <div className="flex flex-col justify-between lg:col-span-4">
              <div>
                {/* Wordmark with Sun Dot */}
                <div className="flex items-baseline gap-2 mb-2">
                  <h2 className="m-0 font-display text-34 font-black tracking-tight text-ink sm:text-40 leading-none">
                    شينا كير
                  </h2>
                  <span
                    title="ShinaCare Sun"
                    className="size-2 rounded-full bg-citron ring-2 ring-citron/40 shadow-outline-hairline inline-block"
                  />
                </div>

                {/* Latin Monogram / Subtitle */}
                <div className="font-serif italic text-15 text-stone mb-4 sm:text-16">
                  {m.footerLatinCampaign}
                </div>

                {/* Tagline & Verbatim Description */}
                <div className="flex flex-col gap-1 max-w-sm font-display">
                  <p className="m-0 text-15 font-bold text-ink leading-snug">
                    {m.footerEditorialHeadline}
                  </p>
                  <p className="m-0 text-13 leading-20 text-stone sm:text-14 sm:leading-22">
                    {m.footerEditorialBody}
                  </p>
                </div>
              </div>

              {/* Desktop Consultation Badge */}
              <div className="hidden md:flex items-center gap-3.5 mt-8 pt-6 border-t border-line">
                <span className="flex size-8 flex-none items-center justify-center rounded-full bg-citron text-ink text-12 font-bold shadow-elevation-1">
                  ✦
                </span>
                <div className="flex flex-col">
                  <span className="text-12 font-bold font-display text-ink">
                    {m.footerConsultationPrompt}
                  </span>
                  <Link
                    href={shellRoutes.shina}
                    className="group inline-flex items-center gap-1 font-display text-12 font-semibold text-cobalt hover:underline"
                  >
                    <span>{m.footerConsultationAction}</span>
                    <Icon
                      name="arrow-forward"
                      size={12}
                      className="transition-transform group-hover:-translate-x-0.5"
                    />
                  </Link>
                </div>
              </div>

              {/* Mobile Consultation Banner */}
              <div className="block md:hidden mt-6">
                <Link
                  href={shellRoutes.shina}
                  className="flex items-center justify-between w-full h-11 px-4 rounded-pill bg-chalk border border-line text-12 font-bold text-ink active:bg-sand transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-5.5 items-center justify-center rounded-full bg-citron text-ink text-11 font-bold">
                      ✦
                    </span>
                    <span className="font-display">{m.footerConsultationMobile}</span>
                  </div>
                  <Icon name="arrow-forward" size={13} className="text-cobalt" />
                </Link>
              </div>
            </div>

            {/* Navigation Columns (8 cols: Shop, Discover, Account, Support) */}
            <div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:col-span-8">
              {columns.map((col) => (
                <div key={col.titleAr} className="flex flex-col">
                  {/* Column Header */}
                  <div className="flex items-center gap-1.5 pb-2 mb-3 border-b border-line/60">
                    <span className="font-display text-13 font-bold uppercase tracking-wider text-ink">
                      {col.titleAr}
                    </span>
                    <span className="font-serif italic text-11 text-stone">
                      {col.titleSubtitle}
                    </span>
                  </div>

                  {/* Navigation Links */}
                  <ul className="m-0 flex flex-col gap-2.5 list-none p-0">
                    {col.items.map((item) => (
                      <li key={item.label}>
                        <Link
                          href={item.href}
                          className="inline-flex min-h-[32px] items-center gap-1.5 font-display text-13 text-ink/80 transition-colors hover:text-cobalt active:text-cobalt"
                        >
                          <span>{item.label}</span>
                          {item.hasSunDot ? (
                            <span className="size-1.5 rounded-full bg-citron" />
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Footer (Copyright, Social Links, Legal) */}
          <div className="flex flex-col items-center justify-between gap-6 text-12 text-stone md:flex-row">
            {/* Copyright & Identity */}
            <div className="flex flex-wrap items-center gap-2 font-display text-center md:text-start">
              <span>{`© ${currentYear}`}</span>
              <span className="font-bold text-ink">شينا كير · ShinaCare</span>
              <span className="text-line-2">·</span>
              <span>{m.footerAllRightsReserved}</span>
            </div>

            {/* Editorial Social Channels */}
            <div className="flex items-center gap-5 text-13 font-serif italic">
              {socialLinks.map((social, i) => (
                <div key={social.label} className="flex items-center gap-5">
                  <a
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-stone transition-colors hover:text-cobalt"
                  >
                    {social.label}
                  </a>
                  {i < socialLinks.length - 1 ? (
                    <span className="text-line-2 font-text not-italic">·</span>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Legal Quick Links & Locale Switch */}
            <div className="flex items-center gap-3 text-11 font-display">
              <Link
                href="/legal/privacy"
                className="text-stone transition-colors hover:text-ink"
              >
                {m.footerPrivacy}
              </Link>
              <span className="text-line-2">/</span>
              <Link
                href="/legal/terms"
                className="text-stone transition-colors hover:text-ink"
              >
                {m.footerTerms}
              </Link>
              <span className="text-line-2">/</span>
              <span className="text-stone">{m.footerCairoEgypt}</span>
              <span className="ms-2">
                <LocaleSwitch tone="onLight" />
              </span>
            </div>
          </div>
        </PageContainer>
      </footer>
    </>
  );
}
