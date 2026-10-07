'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { auth, type User } from '@/lib/auth';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { isLocale } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const m = useMessages();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, [pathname]);

  const loadUser = async () => {
    if (auth.isAuthenticated()) {
      try {
        const userData = await auth.getMe();
        setUser(userData);
      } catch {
        setUser(null);
      }
    } else {
      setUser(null);
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    await auth.logout();
    setUser(null);
    router.push('/');
  };

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
        <Link href={routes.home} className="logo">Shena Care</Link>
        <nav className="nav" aria-label={m.navigation}>
          <Link href={routes.products}>{m.products}</Link>
          {!loading && (
            <>
              {user ? (
                <>
                  <Link href={routes.cart}>{m.cart}</Link>
                  <span className="nav-user">
                    {user.name}
                  </span>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="nav-button"
                  >
                    {m.logout}
                  </button>
                </>
              ) : (
                <>
                  <Link href={routes.login}>{m.login}</Link>
                  <Link href={routes.register}>{m.register}</Link>
                </>
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
