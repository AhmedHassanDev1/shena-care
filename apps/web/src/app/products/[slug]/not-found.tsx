import Link from 'next/link';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';
import { routes } from '@/lib/routes';

export default function NotFound() {
  const m = getMessages(getLocale());
  return (
    <div className="container">
      <div className="not-found">
        <h1>{m.productNotFound}</h1>
        <p>{m.productNotFoundDescription}</p>
        <Link href={routes.products} className="back-link">{m.backToProducts}</Link>
      </div>
    </div>
  );
}
