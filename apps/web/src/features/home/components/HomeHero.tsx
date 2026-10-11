import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Messages } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';

/**
 * One message, one primary action (guidance) and one secondary route (shopping). Copy sits beside the
 * photo, never on it, so the face can't collide with text at any width.
 */
export function HomeHero({ m }: { m: Messages }) {
  return (
    <section aria-labelledby="hero-title" className="grid items-center gap-6 pt-4 md:grid-cols-12 md:gap-10 md:pt-10 lg:pt-12">
      <div className="relative aspect-[3/2] overflow-hidden rounded-lg bg-secondary md:order-2 md:col-span-6 md:aspect-[5/6] lg:col-span-7 lg:aspect-[7/6]">
        <Image
          src="/assets/home/hero-skincare.webp"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 680px, (min-width: 768px) 50vw, 100vw"
          className="object-cover object-[85%_50%]"
        />
      </div>

      <div className="md:order-1 md:col-span-6 lg:col-span-5">
        <p className="flex items-center gap-3 text-support font-semibold text-primary">
          <span aria-hidden="true" className="h-0.5 w-8 shrink-0 bg-primary" />
          {m.heroEyebrow}
        </p>
        <h1 id="hero-title" className="mt-3 text-balance text-display font-bold text-foreground">
          {m.heroTitle}
        </h1>
        <p className="mt-4 max-w-[34rem] text-body text-muted-foreground md:text-body-lg">{m.heroBody}</p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href={routes.routineBuilder}>
              {m.heroPrimaryCta}
              <ArrowRight aria-hidden="true" className="rtl-mirror" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={routes.products}>{m.heroSecondaryCta}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
