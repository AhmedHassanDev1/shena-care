import Link from 'next/link';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

export default function Home() {
  const m = getMessages(getLocale());
  return (
    <div className="container">
      <div className="hero">
        <h1 className="hero-title">{m.homeTitle}</h1>
        <p className="hero-subtitle">{m.homeDescription}</p>
        <Link href={routes.products} className="cta-button">{m.browseProducts}</Link>
      </div>
    </div>
  );
}
