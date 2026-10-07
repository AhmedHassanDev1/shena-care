import { HeroSlide, ConcernCategory, RoutineSnippet } from '../types/home.types';

export const HERO_SLIDES: HeroSlide[] = [
  {
    id: 'slide-1',
    subtitle: 'SKINCARE ROUTINE · 4 STEPS',
    title: 'Healthy, Radiant\nSkin Starts Here',
    description: 'Gentle, effective care for your unique skin.',
    ctaText: 'Explore Routine',
    ctaUrl: '/routine/builder',
    imageUrl: '/assets/home/hero-skincare.webp',
  },
  {
    id: 'slide-2',
    subtitle: 'GLOW-BOOSTING ESSENTIALS',
    title: 'A Brighter Ritual,\nMade for You',
    description: 'Simple daily steps selected around your beauty goals.',
    ctaText: 'Shop Essentials',
    ctaUrl: '/products',
    imageUrl: '/assets/home/skincare-still-life.webp',
  },
];

export const CONCERNS: ConcernCategory[] = [
  { id: 'acne', label: 'Acne', icon: 'Sparkles' },
  { id: 'dryness', label: 'Dryness', icon: 'Droplet' },
  { id: 'dark-spots', label: 'Dark Spots', icon: 'Sun' },
  { id: 'redness', label: 'Redness', icon: 'Wind' },
  { id: 'hair-fall', label: 'Hair Fall', icon: 'Scissors' }, // Using lucide icons mapped to these later
  { id: 'sensitive', label: 'Sensitive Skin', icon: 'Shield' }
];

export const RECOMMENDED_ROUTINES: RoutineSnippet[] = [
  {
    id: 'clear-skin',
    name: 'Clear Skin Routine',
    description: 'Soothes breakouts & repairs barrier',
    concern: 'Acne',
    stepCount: 4,
    timeOfDay: 'AM & PM',
    imageUrl: '/assets/home/skincare-still-life.webp',
  },
  {
    id: 'hydration-glow',
    name: 'Hydration Glow Routine',
    description: 'Restores deep moisture & healthy glow',
    concern: 'Dryness',
    stepCount: 4,
    timeOfDay: 'AM & PM',
    imageUrl: '/assets/home/skincare-still-life.webp',
  },
  {
    id: 'even-tone',
    name: 'Even Tone Routine',
    description: 'Visibly reduces dark spots & evens skin tone',
    concern: 'Dark Spots',
    stepCount: 4,
    timeOfDay: 'AM & PM',
    imageUrl: '/assets/home/skincare-still-life.webp',
  },
  {
    id: 'calming',
    name: 'Calming Routine',
    description: 'Helps soothe reactive, redness-prone skin',
    concern: 'Redness',
    stepCount: 4,
    timeOfDay: 'AM & PM',
    imageUrl: '/assets/home/skincare-still-life.webp',
  }
];
