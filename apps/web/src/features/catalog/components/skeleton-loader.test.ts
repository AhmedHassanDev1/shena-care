import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Sahel Shutter Light Skeleton & Site-wide Loading Animations', () => {
  const root = process.cwd();
  const globalsCss = readFileSync(join(root, 'src', 'app', 'globals.css'), 'utf8');
  const skeletonTsx = readFileSync(join(root, 'src', 'components', 'ui', 'skeleton.tsx'), 'utf8');
  const productCardTsx = readFileSync(join(root, 'src', 'features', 'catalog', 'components', 'ProductCard.tsx'), 'utf8');

  it('defines the signature Sahel Shutter Drift (@keyframes shutterDrift) animation in globals.css', () => {
    expect(globalsCss).toContain('@keyframes shutterDrift');
    expect(globalsCss).toContain('background-position: 200% 0');
    expect(globalsCss).toContain('background-position: -200% 0');
    expect(globalsCss).toContain('.animate-shutter-drift');
    expect(globalsCss).toContain('animation: shutterDrift 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite');
  });

  it('defines .shutter-drift-slats at the signature Sahel 118deg angle', () => {
    expect(globalsCss).toContain('.shutter-drift-slats');
    expect(globalsCss).toContain('repeating-linear-gradient(');
    expect(globalsCss).toContain('118deg');
  });

  it('defines .sahel-skeleton-shadow for the bottle contact shadow', () => {
    expect(globalsCss).toContain('.sahel-skeleton-shadow');
    expect(globalsCss).toContain('filter: blur(4px)');
  });

  it('respects prefers-reduced-motion for shutter drift animation in globals.css', () => {
    expect(globalsCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(globalsCss).toMatch(/\.animate-shutter-drift\s*\{[^}]*animation:\s*none/);
  });

  it('Skeleton primitive component uses animate-shutter-drift with motion-reduce protection', () => {
    expect(skeletonTsx).toContain('animate-shutter-drift');
    expect(skeletonTsx).toContain('motion-reduce:animate-none');
    expect(skeletonTsx).toContain('bg-sand/40');
  });

  it('ProductCardSkeleton implements the 4:5 frame with shutter-drift-slats and packaging silhouette', () => {
    expect(productCardTsx).toContain('export function ProductCardSkeleton');
    expect(productCardTsx).toContain('aspect-[4/5]');
    expect(productCardTsx).toContain('shutter-drift-slats');
    expect(productCardTsx).toContain('animate-shutter-drift');
    expect(productCardTsx).toContain('sahel-skeleton-shadow');
  });
});
