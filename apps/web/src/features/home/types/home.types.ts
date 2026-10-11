export interface RoutineSnippet {
  id: string;
  name: string;
  description: string;
  concern: string;
  stepCount: number;
  timeOfDay: 'AM' | 'PM' | 'AM & PM';
  imageUrl: string;
}

export interface ConcernCategory {
  id: string;
  label: string;
  icon: string; // or an image url/icon name
}

export interface HeroSlide {
  id: string;
  subtitle: string;
  title: string;
  description: string;
  ctaText: string;
  ctaUrl: string;
  imageUrl: string;
}
