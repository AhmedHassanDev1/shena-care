import { Section } from '@/components/layout/section';
import { cardVariants } from '@/components/ui/card-variants';
import { Icon, type IconName } from '@/components/ui/icon';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';

/**
 * Service badges (Stitch's three trust tiles). Only statements the product can stand behind: where it delivers, how you
 * pay (both from the backend-confirmed service copy), and that Shina advises while the customer decides.
 */
export function TrustBadges() {
  const m = getMessages(getLocale());
  const items: Array<{ icon: IconName; title: string; body: string }> = [
    { icon: 'shield', title: m.homeTrustAuthTitle, body: m.homeTrustAuthBody },
    { icon: 'science', title: m.homeTrustFormulaTitle, body: m.homeTrustFormulaBody },
    { icon: 'truck', title: m.homeTrustClimateTitle, body: m.homeTrustClimateBody },
  ];

  return (
    <Section labelledBy="home-trust-title" rhythm="tight">
      <h2 id="home-trust-title" className="sr-only">
        {m.homeTrustAuthTitle} · {m.homeTrustFormulaTitle} · {m.homeTrustClimateTitle}
      </h2>
      <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 lg:gap-4">
        {items.map((it) => (
          <li key={it.title} className={cn(cardVariants(), 'flex flex-col items-center gap-2 p-3 text-center lg:flex-row lg:gap-4 lg:p-5 lg:text-start')}>
            <span className="flex size-10 flex-none items-center justify-center rounded-full bg-bottle-tint text-bottle lg:size-12">
              <Icon name={it.icon} size={22} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-13 font-semibold leading-18 text-night lg:text-16 lg:leading-25">{it.title}</span>
              <span className="text-11.5 leading-16 text-ink-2 lg:text-14 lg:leading-22">{it.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
