import Link from 'next/link';
import { Droplet, ShieldPlus, Sparkles, Waves, Wind } from 'lucide-react';
import { CONCERNS } from '../data/home-content';

const iconMap: Record<string, React.ElementType> = {
  Sparkles,
  Droplet,
  Sun: Sparkles,
  Wind,
  Scissors: Waves,
  Shield: ShieldPlus,
};

const concernClass: Record<string, string> = {
  acne: 'concern-acne',
  dryness: 'concern-dryness',
  'dark-spots': 'concern-dark',
  redness: 'concern-redness',
  'hair-fall': 'concern-hair',
  sensitive: 'concern-sensitive',
};

export function ConcernStrip() {
  return (
    <section id="concerns" className="concern-strip" aria-label="Shop by concern">
      {CONCERNS.map((concern) => {
        const Icon = iconMap[concern.icon] || Sparkles;
        return (
          <Link key={concern.id} href={'/products?concern=' + encodeURIComponent(concern.id)} className={concernClass[concern.id]}>
            <span><Icon aria-hidden="true" /></span>
            <strong>{concern.label}</strong>
          </Link>
        );
      })}
    </section>
  );
}
