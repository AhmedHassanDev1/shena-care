'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { auth, type User } from '@/lib/auth';

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
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

  return (
    <header className="site-header">
      <div className="container">
        <a href="/" className="logo">Shena Care</a>
        <nav className="nav">
          <a href="/products">Products</a>
          {!loading && (
            <>
              {user ? (
                <>
                  <a href="/cart">Cart</a>
                  <span style={{ color: 'var(--color-text-light)' }}>
                    {user.name}
                  </span>
                  <button
                    onClick={handleLogout}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text)',
                      fontWeight: 500,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <a href="/auth/login">Login</a>
                  <a href="/auth/register">Register</a>
                </>
              )}
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
