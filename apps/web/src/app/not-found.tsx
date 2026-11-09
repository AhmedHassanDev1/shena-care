import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { routes } from '@/lib/routes';

export default function NotFound() {
  return (
    <section className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center" role="alert">
      <h2 className="font-display text-32 font-bold text-ink">الصفحة غير موجودة</h2>
      <p className="mt-3 text-15 font-display text-stone">لم نتمكن من العثور على الصفحة التي تبحث عنها.</p>
      <Link href={routes.home} className="mt-6">
        <Button variant="cobalt" size="m">
          العودة للرئيسية
        </Button>
      </Link>
    </section>
  );
}
