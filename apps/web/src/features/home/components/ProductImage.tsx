'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Icon } from '@/components/ui/icon';
import { ProductArt } from '@/components/ui/product-art';
import type { ProductCardModel } from '../lib/products';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { canOptimizeImage } from '../lib/images';

/** Packshot that keeps its proportions; a missing or broken image becomes a quiet placeholder. */
export function ProductImage({ src, alt, priority = false, art }: { src: string | null; alt: string; priority?: boolean; art?: ProductCardModel['art'] }) {
  const m = useMessages();
  const [failed, setFailed] = useState(false);

  if (art) {
    // Preview fixtures only: a silhouette standing in for a photograph, never a real product image.
    return (
      <div className="flex size-full items-end justify-center">
        <ProductArt shape={art.shape} tint={art.tint} size={120} className="h-[88%] w-auto" />
      </div>
    );
  }

  if (!src || failed) {
    return (
      <div role="img" aria-label={m.productNoImage} className="flex size-full items-center justify-center text-ink-subtle">
        <Icon name="box" size={32} />
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      priority={priority}
      unoptimized={!canOptimizeImage(src)}
      sizes="(min-width: 1280px) 280px, (min-width: 768px) 30vw, 46vw"
      onError={() => setFailed(true)}
      className="object-contain mix-blend-multiply"
    />
  );
}
