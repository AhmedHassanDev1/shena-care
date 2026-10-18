import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/icon';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes, shellRoutes } from '@/lib/routes';
import { cn } from '@/lib/utils';

export type FloatingNavItem = 'home' | 'shop' | 'shina' | 'routines' | 'account';

/**
 * FloatingNav (04-components/FloatingNav.dc.html, NavBoard) — the approved phone navigation, never the old tab bar.
 * Night capsule 68 tall, 6px padding, fully rounded, two-layer shadow; fixed 12 from each side and
 * `bottom: 12 + safe-area`. RTL order الرئيسية · تسوّق · شينا · الروتين · حسابي. Selected = bone capsule behind a night
 * icon + bold label + aria-current="page" (never colour alone); «شينا» is a saffron orb the size of the icons.
 * Press scales the capsule to .92 (off under reduced motion); focus is a saffron ring inside the capsule.
 * Hidden from lg. Pages that show it end their content 32 above it (`pb-nav-safe`).
 */
export function FloatingNav({ active }: { active: FloatingNavItem | 'none' }) {
  const m = getMessages(getLocale());
  const items: Array<{ id: FloatingNavItem; href: string; label: string; icon?: IconName }> = [
    { id: 'home', href: routes.home, label: m.fnHome, icon: 'home' },
    { id: 'shop', href: routes.products, label: m.fnShop, icon: 'shop' },
    { id: 'shina', href: shellRoutes.shina, label: m.fnShina },
    { id: 'routines', href: shellRoutes.routines, label: m.fnRoutine, icon: 'routine' },
    { id: 'account', href: routes.account, label: m.fnAccount, icon: 'user' },
  ];

  return (
    <nav
      aria-label={m.fnLabel}
      className="floating-nav z-nav grid h-nav-h grid-cols-5 rounded-pill bg-night p-1.5 font-text shadow-nav lg:hidden"
    >
      {items.map((item) => {
        const on = item.id === active;
        const shina = item.id === 'shina';
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'group flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-pill no-underline transition-colors duration-fast ease-standard',
              'focus-visible:outline-saffron focus-visible:[outline-offset:-4px]',
              on ? 'text-bone' : 'text-bone/[.66]'
            )}
          >
            <span
              className={cn(
                'relative flex h-7.5 w-12 items-center justify-center rounded-pill transition-[background-color,transform] duration-fast ease-standard motion-safe:group-active:scale-[.92]',
                on ? (shina ? 'bg-saffron/[.22]' : 'bg-bone text-night') : 'bg-transparent'
              )}
            >
              {item.icon ? (
                <Icon name={item.icon} size={22} />
              ) : (
                <span
                  aria-hidden="true"
                  data-on={on || undefined}
                  className="sun-orb size-5.5"
                />
              )}
            </span>
            <span className={cn('text-11 leading-14', on ? 'font-bold' : 'font-medium')}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
