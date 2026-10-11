import { cn } from '@/lib/utils';

interface SequenceTrackProps {
  /** Ordered labels. Only pass a real order (builder questions, a care sequence) — never decoration. */
  items: string[];
  formatIndex: (n: number) => string;
  className?: string;
}

/**
 * Shena Care's guidance motif: numbered points on one connecting line, read in the page direction.
 * The line spans from the first to the last marker centre, so it mirrors with RTL automatically.
 */
export function SequenceTrack({ items, formatIndex, className }: SequenceTrackProps) {
  const inset = `${50 / items.length}%`;
  return (
    <ol
      className={cn('relative grid gap-1', className)}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      <span aria-hidden="true" className="absolute top-4 h-0.5 bg-primary/25" style={{ insetInline: inset }} />
      {items.map((label, index) => (
        <li key={label} className="relative flex flex-col items-center gap-2 text-center">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-full border-2 border-primary bg-card text-caption font-semibold text-primary"
          >
            {formatIndex(index + 1)}
          </span>
          <span className="text-caption font-medium text-foreground">{label}</span>
        </li>
      ))}
    </ol>
  );
}
