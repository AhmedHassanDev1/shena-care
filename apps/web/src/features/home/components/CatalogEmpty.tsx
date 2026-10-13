import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button-variants';
import { Icon } from '@/components/ui/icon';
import { ProductNiche } from '@/components/ui/product-niche';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * Truthful fallback for a catalog with nothing orderable: says so plainly (no stock is implied), keeps the
 * shopper moving (routine builder, store search), and stays compact so an empty shelf never dominates Home.
 */
export function CatalogEmpty() {
  const m = getMessages(getLocale());
  return (
    <div data-atmosphere="peach" className="grid items-center gap-5 rounded-md bg-gradient-to-br from-atm-wash to-atm-surface p-5 sm:grid-cols-[auto_1fr] sm:gap-8 sm:p-6">
      <ProductNiche className="hidden w-28 sm:block" aria-hidden="true">
        <div className="grid size-full place-items-center text-atm-ink">
          <Icon name="box" size={40} />
        </div>
      </ProductNiche>
      <div className="grid gap-3">
        <h3 className="text-title text-foreground">{m.productsEmptyTitle}</h3>
        <p className="max-w-[40rem] text-body text-ink-soft">{m.productsEmptyBody}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Link href={routes.routineBuilder} className={buttonVariants()}>
            {m.productsEmptyRoutine}
          </Link>
          <Link href={routes.products} className={cn(buttonVariants({ variant: 'secondary' }))}>
            {m.productsEmptyBrowse}
          </Link>
        </div>
      </div>
    </div>
  );
}
