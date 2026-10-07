'use client';

import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { isLocale } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { useAuth } from '@/features/auth/AuthContext';

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const m = useMessages();
  const { user, isLoading, signOut, requireAuth } = useAuth();

  const changeLocale = (nextLocale: string) => {
    if (!isLocale(nextLocale) || nextLocale === locale) return;
    document.cookie = `shena-locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = nextLocale;
    document.documentElement.dir = nextLocale === 'ar' ? 'rtl' : 'ltr';
    router.refresh();
  };

  if (pathname === '/') return null;

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href={routes.home} className="logo">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-norya-gold/20 flex items-center justify-center">
              <div className="w-3 h-3 bg-norya-gold rounded-full opacity-60" />
            </div>
            ShenaCare
          </div>
        </Link>
        <nav className="nav" aria-label={m.navigation}>
          <Link href={routes.products}>{m.products}</Link>
          {!isLoading && (
            <>
              {user ? (
                <>
                  <Link href={routes.cart}>{m.cart}</Link>
                  <span className="nav-user">{user.name || 'User'}</span>
                  <button type="button" onClick={() => signOut()} className="nav-button">
                    {m.logout}
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => requireAuth()} className="nav-button font-medium">
                  {m.login}
                </button>
              )}
            </>
          )}
        </nav>
        <div className="locale-control">
          <select aria-label={m.language} value={locale} onChange={(event) => changeLocale(event.target.value)}>
            <option value="en">{m.english}</option>
            <option value="ar">{m.arabic}</option>
          </select>
        </div>
      </div>
    </header>
  );
}
