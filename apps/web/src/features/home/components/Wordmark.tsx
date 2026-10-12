import Link from 'next/link';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/** Latin wordmark. lang="en" keeps the letter-spacing that the global Arabic rule resets. */
export function Wordmark({ className, label }: { className?: string; label: string }) {
  return (
    <Link
      href={routes.home}
      aria-label={label}
      className={cn('inline-flex min-h-11 items-center rounded-md px-1', className)}
    >
      <span lang="en" dir="ltr" className="text-[1.25rem] font-semibold leading-none tracking-[0.3em] text-foreground">
        SHINA<span className="text-primary">CARE</span>
      </span>
    </Link>
  );
}
