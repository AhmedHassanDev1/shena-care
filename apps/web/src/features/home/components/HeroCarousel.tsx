'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { HERO_SLIDES } from '../data/home-content';

export function HeroCarousel() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const goTo = (index: number) => {
    const next = (index + HERO_SLIDES.length) % HERO_SLIDES.length;
    setActive(next);
    trackRef.current?.children[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  };

  return (
    <section className="hero-carousel" aria-label="Featured beauty routines">
      <div ref={trackRef} className="hero-track" onScroll={(event) => {
        const element = event.currentTarget;
        const index = Math.round(element.scrollLeft / Math.max(element.clientWidth, 1));
        if (index !== active && index >= 0 && index < HERO_SLIDES.length) setActive(index);
      }}>
        {HERO_SLIDES.map((slide, index) => (
          <article key={slide.id} className="hero-slide">
            <Image
              src={slide.imageUrl}
              alt=""
              fill
              priority={index === 0}
              sizes="(max-width: 767px) 100vw, 65vw"
              className="hero-photo"
            />
            <div className="hero-copy">
              <span className="eyebrow">{slide.subtitle}</span>
              <h2>{slide.title.split('\n').map((line) => <span key={line}>{line}</span>)}</h2>
              <p>{slide.description}</p>
              <Link href={slide.ctaUrl} className="primary-cta">
                {slide.ctaText}<ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </article>
        ))}
      </div>
      <div className="hero-controls">
        <button type="button" onClick={() => goTo(active - 1)} aria-label="Previous hero slide"><ArrowLeft aria-hidden="true" /></button>
        <div className="hero-dots" aria-label={'Slide ' + (active + 1) + ' of ' + HERO_SLIDES.length}>
          {HERO_SLIDES.map((slide, index) => (
            <button key={slide.id} type="button" className={index === active ? 'is-active' : undefined} onClick={() => goTo(index)} aria-label={'Go to slide ' + (index + 1)} />
          ))}
        </div>
        <button type="button" onClick={() => goTo(active + 1)} aria-label="Next hero slide"><ArrowRight aria-hidden="true" /></button>
      </div>
    </section>
  );
}
