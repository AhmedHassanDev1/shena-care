import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface SectionHeadingProps {
  id: string;
  title: string;
  subtitle?: string;
  action?: { href: string; label: string };
}

export function SectionHeading({ id, title, subtitle, action }: SectionHeadingProps) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 md:mb-7">
      <div className="min-w-0">
        <h2 id={id} className="text-h2 font-semibold text-foreground">
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-support text-muted-foreground md:text-body">{subtitle}</p> : null}
      </div>
      {action ? <SectionLink href={action.href}>{action.label}</SectionLink> : null}
    </div>
  );
}

export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-1 text-support font-semibold text-primary underline-offset-4 hover:underline"
    >
      {children}
      <ArrowRight aria-hidden="true" className="rtl-mirror size-4" />
    </Link>
  );
}
