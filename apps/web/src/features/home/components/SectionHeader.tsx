import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface SectionHeaderProps {
  id: string;
  title: string;
  subtitle?: string;
  href?: string;
  linkLabel?: string;
}

export function SectionHeader({ id, title, subtitle, href, linkLabel }: SectionHeaderProps) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 lg:mb-6">
      <div>
        <h2 id={id} className="text-h3 text-foreground lg:text-h2">
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-support text-muted-foreground">{subtitle}</p> : null}
      </div>
      {href && linkLabel ? (
        <Link
          href={href}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-1 text-support font-medium text-primary hover:text-primary-hover"
        >
          {linkLabel}
          <ArrowLeft aria-hidden="true" className="size-4 ltr:rotate-180" />
        </Link>
      ) : null}
    </div>
  );
}
