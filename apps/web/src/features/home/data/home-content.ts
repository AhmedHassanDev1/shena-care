import { HeroSlide, ConcernCategory, RoutineSnippet } from '../types/home.types';

export const HERO_SLIDES: HeroSlide[] = [
  {
    id: 'slide-1',
    subtitle: 'SKINCARE ROUTINE · 4 STEPS',
    title: 'Healthy, Radiant\nSkin Starts Here',
    description: 'Gentle, effective care for your unique skin.',
    ctaText: 'Explore Routine →',
    ctaUrl: '/routines/radiant-glow',
    imageUrl: 'https://images.unsplash.com/photo-1556228578-0d85b1a4d571?q=80&w=1000&auto=format&fit=crop', // placeholder
  }
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
    imageUrl: 'https://images.unsplash.com/photo-1615397323285-056345cb3439?q=80&w=500&auto=format&fit=crop',
  },
  {
    id: 'hydration-glow',
    name: 'Hydration Glow Routine',
    description: 'Restores deep moisture & healthy glow',
    concern: 'Dryness',
    stepCount: 4,
    timeOfDay: 'AM & PM',
    imageUrl: 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?q=80&w=500&auto=format&fit=crop',
  },
  {
    id: 'even-tone',
    name: 'Even Tone Routine',
    description: 'Visibly reduces dark spots & evens skin tone',
    concern: 'Dark Spots',
    stepCount: 4,
    timeOfDay: 'AM & PM',
    imageUrl: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?q=80&w=500&auto=format&fit=crop',
  },
  {
    id: 'calming',
    name: 'Calming Routine',
    description: 'Helps soothe reactive, redness-prone skin',
    concern: 'Redness',
    stepCount: 4,
    timeOfDay: 'AM & PM',
    imageUrl: 'https://images.unsplash.com/photo-1556228720-192a6af4e11e?q=80&w=500&auto=format&fit=crop',
  }
];
