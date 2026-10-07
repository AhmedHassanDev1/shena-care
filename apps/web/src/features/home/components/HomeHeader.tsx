import Link from 'next/link';
import {
  Bell,
  ChevronDown,
  Flower2,
  Menu,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { routes } from '@/lib/routes';

export function HomeHeader() {
  return (
    <header className="home-header">
      <div className="home-header-inner">
        <Link href={routes.home} className="brand-lockup" aria-label="ShenaCare home">
          <Flower2 aria-hidden="true" />
          <span>Shena<span>Care</span></span>
        </Link>

        <nav className="desktop-home-nav" aria-label="Store navigation">
          <Link href={routes.products}>Shop <ChevronDown aria-hidden="true" /></Link>
          <Link href={routes.routineBuilder}>Routines</Link>
          <Link href="/products?view=brands">Brands</Link>
          <Link href="#concerns">Concerns</Link>
        </nav>

        <form className="desktop-search" action={routes.products} role="search">
          <Search aria-hidden="true" />
          <input name="search" placeholder="Search for products, concerns, routines..." aria-label="Search the store" />
          <button type="submit" aria-label="Search filters"><SlidersHorizontal aria-hidden="true" /></button>
        </form>

        <div className="desktop-actions">
          <button type="button" className="header-icon" aria-label="Notifications">
            <Bell aria-hidden="true" />
            <span className="notification-badge">3</span>
          </button>
          <Link href={routes.cart} className="header-icon" aria-label="Shopping cart"><ShoppingBag aria-hidden="true" /></Link>
          <Link href={routes.login} className="profile-link">
            <span className="profile-avatar"><UserRound aria-hidden="true" /></span>
            <span>Hello, Sara</span>
            <ChevronDown aria-hidden="true" />
          </Link>
        </div>

        <div className="mobile-home-header">
          <button type="button" className="mobile-menu" aria-label="Open menu"><Menu aria-hidden="true" /></button>
          <div className="mobile-greeting">
            <p>Hello, Glow Girl! <Sparkles aria-hidden="true" /></p>
            <h1>Discover Beauty</h1>
            <span>Guidance for your skin &amp; hair</span>
          </div>
          <div className="mobile-actions">
            <button type="button" className="header-icon" aria-label="Notifications">
              <Bell aria-hidden="true" />
              <span className="notification-badge">3</span>
            </button>
            <Link href={routes.cart} className="header-icon" aria-label="Shopping cart"><ShoppingBag aria-hidden="true" /></Link>
          </div>
        </div>
      </div>
    </header>
  );
}
