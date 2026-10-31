'use client';

import { useRef } from 'react';
import Image from 'next/image';
import { LazyMotion, domAnimation, m, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { HOME_IMAGES } from '../lib/home-images';

/**
 * The hero campaign photograph. It settles in from a slight zoom on load and drifts a few percent as the page scrolls;
 * both are switched off for people who prefer reduced motion. Fills its (positioned) parent.
 */
export function HeroPhoto() {
  const t = useMessages();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], ['0%', '8%']);
  const hero = HOME_IMAGES.hero;

  return (
    <LazyMotion features={domAnimation} strict>
      <div ref={ref} className="absolute inset-0 overflow-hidden">
        <m.div
          className="absolute inset-x-0 -inset-y-[5%]"
          style={reduce ? undefined : { y }}
          initial={reduce ? false : { scale: 1.1 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <Image
            src={hero.src}
            alt={t.homeHeroPhotoAlt}
            fill
            priority
            sizes="(min-width: 1024px) 700px, 100vw"
            className="object-cover"
            style={{ objectPosition: hero.position }}
          />
          {/* Sunlight Through Window / Shutter Shadow Overlay */}
          <div aria-hidden="true" className="hero-sunlight">
            <div className="hero-sunlight-ambience" />
            <div className="hero-sunlight-shadows" />
            <div className="hero-sunlight-beams" />
          </div>
        </m.div>
      </div>
    </LazyMotion>
  );
}
