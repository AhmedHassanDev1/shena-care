import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HERO_SLIDES } from '../data/home-content';

export function HeroCarousel() {
  return (
    <div className="px-4 py-4">
      <div className="relative flex overflow-x-auto snap-x snap-mandatory scrollbar-hide gap-4 pb-4">
        {HERO_SLIDES.map((slide) => (
          <div 
            key={slide.id} 
            className="snap-center shrink-0 w-full rounded-2xl overflow-hidden relative bg-[#FCE8E6] flex"
          >
            {/* Content Left */}
            <div className="relative z-10 w-[60%] p-5 flex flex-col justify-center">
              <div className="inline-flex bg-background/80 backdrop-blur-sm rounded-full px-2 py-1 mb-2 self-start">
                <span className="text-[10px] font-bold tracking-wider uppercase text-foreground">
                  {slide.subtitle}
                </span>
              </div>
              <h2 className="text-xl md:text-2xl font-bold leading-tight mb-2 whitespace-pre-line text-foreground">
                {slide.title}
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                {slide.description}
              </p>
              <Button asChild className="self-start rounded-full shadow-md bg-primary hover:bg-primary/90">
                <Link href={slide.ctaUrl}>{slide.ctaText}</Link>
              </Button>
            </div>
            
            {/* Image Right */}
            <div className="absolute inset-y-0 right-0 w-[50%] z-0">
              <div className="absolute inset-0 bg-gradient-to-r from-[#FCE8E6] via-[#FCE8E6]/80 to-transparent z-10 hidden md:block" />
              <img 
                src={slide.imageUrl} 
                alt="Hero banner" 
                className="w-full h-full object-cover object-left"
              />
            </div>
          </div>
        ))}
      </div>
      {/* Pagination dots */}
      <div className="flex justify-center gap-1.5 -mt-1">
        <div className="w-4 h-1.5 rounded-full bg-primary" />
        <div className="w-1.5 h-1.5 rounded-full bg-muted" />
        <div className="w-1.5 h-1.5 rounded-full bg-muted" />
        <div className="w-1.5 h-1.5 rounded-full bg-muted" />
      </div>
    </div>
  );
}
