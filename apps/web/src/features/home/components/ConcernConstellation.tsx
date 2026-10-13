import { ConcernGlyph } from '@/components/ui/concern-glyph';
import type { ConcernGlyphName } from '@/components/ui/concern-glyph';
import { cn } from '@/lib/utils';

/** Glyph, position (% of the frame, logical start/top) and diameter. Hand-placed so the cluster feels organic, never gridded. */
const CHIPS: Array<{ glyph: ConcernGlyphName; x: number; y: number; size: string; tone: string }> = [
  { glyph: 'sensitive', x: 38, y: 34, size: 'size-24', tone: 'bg-card text-atm-ink' },
  { glyph: 'acne', x: 10, y: 14, size: 'size-16', tone: 'bg-card text-atm-ink' },
  { glyph: 'dry', x: 66, y: 8, size: 'size-20', tone: 'bg-atm-accent text-foreground' },
  { glyph: 'pigment', x: 76, y: 52, size: 'size-16', tone: 'bg-card text-atm-ink' },
  { glyph: 'oily', x: 12, y: 58, size: 'size-20', tone: 'bg-card text-atm-ink' },
  { glyph: 'hairfall', x: 54, y: 72, size: 'size-16', tone: 'bg-atm-accent text-foreground' },
  { glyph: 'frizz', x: 28, y: 80, size: 'size-14', tone: 'bg-card text-atm-ink' },
];

/**
 * Campaign artwork for the "by concern" slide: the abstract concern glyphs floating inside soft rings.
 * Pure vector/CSS in the lilac atmosphere — campaign-only decoration, no product or packaging, hidden
 * from assistive technology (the slide's text carries the message).
 */
export function ConcernConstellation({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('relative size-full overflow-hidden', className)}>
      <span className="absolute inset-[8%] rounded-pill border border-atm-accent/40" />
      <span className="absolute inset-[24%] rounded-pill border border-atm-accent/30" />
      <span className="absolute inset-[40%] rounded-pill bg-atm-accent/15 blur-xl" />
      {CHIPS.map(({ glyph, x, y, size, tone }) => (
        <span
          key={glyph}
          style={{ insetInlineStart: `${x}%`, insetBlockStart: `${y}%` }}
          // On phones the copy rises into the lower half of the frame, so only the upper cluster is drawn there.
          className={cn('absolute grid place-items-center rounded-pill shadow-float', size, tone, y > 55 && 'max-sm:hidden')}
        >
          <ConcernGlyph name={glyph} size={28} />
        </span>
      ))}
    </div>
  );
}
