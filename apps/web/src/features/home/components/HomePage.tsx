import Link from 'next/link';
import { PageContainer } from '@/components/layout/page-container';
import { buttonVariants } from '@/components/ui/button-variants';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

/**
 * Functional homepage placeholder preserving core navigation and route contract
 * without visual marketing artifacts.
 */
export function HomePage() {
  const locale = getLocale();
  const m = getMessages(locale);

  return (
    <StorefrontShell nav="home">
      <PageContainer className="mx-auto flex min-h-[60dvh] max-w-narrow flex-col items-start justify-center gap-4 px-4 py-16">
        <h1 className="m-0 text-display-1 text-night">
          {m.homeMetaTitle}
        </h1>
        <p className="m-0 text-15 leading-27 text-ink-2">
          {m.homeMetaDescription}
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href={routes.products} className={buttonVariants({ variant: 'blue', size: 'm' })}>
            {m.fnShop}
          </Link>
          <Link href={routes.cart} className={buttonVariants({ variant: 'light', size: 'm' })}>
            {m.cartTitle}
          </Link>
          <Link href={routes.account} className={buttonVariants({ variant: 'light', size: 'm' })}>
            {m.shellAccount}
          </Link>
        </div>
      </PageContainer>
    </StorefrontShell>
  );
}
