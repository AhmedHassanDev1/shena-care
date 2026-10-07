import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

const categories = [
  {
    title: 'Skin Care',
    copy: 'Cleansers, serums, moisturizers & more.',
    href: '/products?category=skin-care',
    image: '/assets/home/skincare-still-life.webp',
  },
  {
    title: 'Hair Care',
    copy: 'Healthy hair, happier you.',
    href: '/products?category=hair-care',
    image: '/assets/home/haircare-still-life.webp',
  },
];

export function CategoryPromo() {
  return (
    <section className="category-promos" aria-label="Shop by category">
      {categories.map((category) => (
        <Link key={category.title} href={category.href} className="category-promo">
          <Image src={category.image} alt="" fill sizes="(max-width: 767px) 50vw, 50vw" />
          <span>
            <strong>{category.title}</strong>
            <small>{category.copy}</small>
            <b>Explore <ArrowRight aria-hidden="true" /></b>
          </span>
        </Link>
      ))}
    </section>
  );
}
