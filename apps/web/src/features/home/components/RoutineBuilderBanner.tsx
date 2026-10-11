import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, CalendarDays, Target } from 'lucide-react';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

export function RoutineBuilderBanner({ compact = false }: { compact?: boolean }) {
  return (
    <section className={cn('routine-builder', compact && 'is-compact')}>
      <Image
        src="/assets/home/routine-builder.webp"
        alt=""
        fill
        sizes={compact ? '(min-width: 768px) 35vw' : '100vw'}
        className="routine-builder-photo"
      />
      <div className="routine-builder-content">
        <span className="eyebrow">PERSONALIZED FOR YOU</span>
        <h2>Create Your Routine</h2>
        <p>Tell us your concerns and we&apos;ll build a routine around them.</p>
        <Link href={routes.routineBuilder} className="primary-cta">
          Build My Routine <ArrowRight aria-hidden="true" />
        </Link>
      </div>
      <div className="routine-benefits">
        <div><Target aria-hidden="true" /><span><strong>Based on your concerns</strong><small>Personalized recommendations</small></span></div>
        <div><CalendarDays aria-hidden="true" /><span><strong>Ongoing follow-up</strong><small>Help you stay consistent</small></span></div>
      </div>
    </section>
  );
}
