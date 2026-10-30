import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icon';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes, shellRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

export type DockItem = 'home' | 'routines' | 'shop' | 'account';

/**
 * Phone dock (Stitch «floating frosted pill»): home, my routine, shop, account. A frosted capsule lifted off the bottom
 * edge, phones only. The active entry carries `aria-current` as well as its tint, so state is never colour alone.
 */
export function MobileDock({ active }: { active: DockItem }) {
  const m = getMessages(getLocale());
  const items: Array<{ id: DockItem; href: string; icon: IconName; label: string }> = [
    { id: 'home', href: routes.home, icon: 'home', label: m.homeNavHome },
    { id: 'routines', href: shellRoutes.routines, icon: 'routine', label: m.footerMyRoutine },
    { id: 'shop', href: routes.products, icon: 'shop', label: m.fnShop },
    { id: 'account', href: routes.account, icon: 'user', label: m.homeNavAccount },
  ];

  return (
    <nav aria-label={m.homeNavLabel} className="pointer-events-none fixed inset-x-0 bottom-0 z-nav pb-safe lg:hidden">
      <div className="mx-auto flex justify-center px-4 pb-3">
        <ul className="pointer-events-auto m-0 flex h-16 w-full max-w-sm list-none items-center justify-around rounded-pill bg-linen/80 p-1.5 shadow-nav backdrop-blur-xl">
          {items.map((it) => {
            const isActive = it.id === active;
            return (
              <li key={it.id}>
                <Link
                  href={it.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex h-13 min-w-[72px] flex-col items-center justify-center gap-0.5 rounded-pill px-3 text-12 font-semibold leading-16 no-underline transition-colors duration-fast ease-standard',
                    isActive ? 'bg-bottle-tint text-bottle' : 'text-ink-2 hover:text-night'
                  )}
                >
                  <Icon name={it.icon} size={22} />
                  <span>{it.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
