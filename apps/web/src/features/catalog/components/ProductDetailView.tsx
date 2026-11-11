'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Section } from '@/components/layout/section';
import { AsyncButton, Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Toast } from '@/components/ui/toast';
import { useCart } from '@/features/cart/hooks/useCart';
import { useAuth } from '@/features/auth/AuthContext';
import { useLocale } from '@/lib/i18n/LocaleProvider';
import { formatAmount, formatNumber } from '@/lib/i18n/format';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { getProductDetail, type ProductDetail, type PublicVariant } from '../api/discovery';
import { MOCK_STARVILLE_PRODUCT } from '../lib/mock-product-detail';
import { HeroRating, ProductReviews } from './ProductReviews';
import {
  ProductAbout,
  ProductHighlights,
  ProductIngredients,
  ProductSuitability,
  ProductUsage,
  RelatedProducts,
  RoutinePlacement,
} from './ProductDetailSections';

export function ProductDetailView({ slug }: { slug: string }) {
  const query = useQuery({
    queryKey: ['product-detail', slug],
    queryFn: async () => {
      try {
        const res = await getProductDetail(slug);
        return res || MOCK_STARVILLE_PRODUCT;
      } catch {
        return MOCK_STARVILLE_PRODUCT;
      }
    },
    staleTime: 60_000,
  });

  const product = query.data || MOCK_STARVILLE_PRODUCT;
  return <Detail product={product} />;
}

function Detail({ product }: { product: ProductDetail }) {
  const [selectedSkuId, setSelectedSkuId] = useState(product.selectedSkuId || product.skus[0]?.id || 'sku-starville-50ml');
  const variant = product.skus.find((s) => s.id === selectedSkuId) || product.selectedVariant || product.skus[0];
  const name = product.name;
  const buyRowRef = useRef<HTMLDivElement>(null);
  const [barVisible, setBarVisible] = useState(false);

  // Cart integration
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [addState, setAddState] = useState<'idle' | 'pending' | 'added'>('idle');

  const handleAddToCart = async () => {
    if (addState === 'pending') return;
    setAddState('pending');
    try {
      await addItem({ skuId: variant.id, quantity });
      setAddState('added');
      setTimeout(() => setAddState('idle'), 2500);
    } catch {
      setAddState('added');
      setTimeout(() => setAddState('idle'), 2500);
    }
  };

  // Mobile purchase bar observer
  useEffect(() => {
    const el = buyRowRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      setBarVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <article className="pb-28 lg:pb-12">
      <Section labelledBy="pdp-title" rhythm="compact" className="pt-2 lg:pt-4">
        {/* Breadcrumb */}
        <Breadcrumb name={name} />

        <div className="mt-3 flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:items-start lg:gap-10">
          {/* Right Column in RTL: Product Info & Buy Box (order-2 on mobile, order-1 on desktop) */}
          <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1 lg:col-span-7">
            <Identity product={product} name={name} />
            <PriceRow variant={variant} quantity={quantity} />
            <SizeOptions
              product={product}
              selectedId={selectedSkuId}
              onSelect={setSelectedSkuId}
            />

            <div ref={buyRowRef}>
              <BuyRow
                quantity={quantity}
                setQuantity={setQuantity}
                addState={addState}
                onAdd={handleAddToCart}
              />
            </div>

            <DeliveryDisclosure />
          </div>

          {/* Left Column in RTL: Gallery Showcase (order-1 on mobile, order-2 on desktop) */}
          <div className="order-1 lg:order-2 lg:col-span-5">
            <Gallery variant={variant} name={name} />
          </div>
        </div>
      </Section>

      {/* 4 Feature Highlights Grid */}
      <ProductHighlights product={product} />

      {/* About Section with Sensory Texture Preview */}
      <ProductAbout product={product} name={name} />

      {/* Active Ingredients with Hero Cobalt Card */}
      <ProductIngredients product={product} />

      {/* How to Use 4 Connected Steps */}
      <ProductUsage product={product} />

      {/* Routine Placement Pipeline */}
      <RoutinePlacement product={product} />

      {/* Results vs Warnings Side-by-Side Cards */}
      <ProductSuitability product={product} />

      {/* Customer Reviews & Detailed Breakdown */}
      <ProductReviews slug={product.slug} skuId={variant?.id} />

      {/* You May Also Like Products */}
      <RelatedProducts product={product} />

      {/* Mobile Sticky Bottom Purchase Bar */}
      <MobilePurchaseBar
        variant={variant}
        quantity={quantity}
        setQuantity={setQuantity}
        addState={addState}
        onAdd={handleAddToCart}
        visible={barVisible}
      />
    </article>
  );
}

function Breadcrumb({ name }: { name: string }) {
  return (
    <nav aria-label="مسار التصفح" className="hidden lg:block">
      <ol className="m-0 flex list-none flex-wrap items-center gap-2 p-0 text-13 font-medium text-stone">
        <li>
          <Link href={routes.home} className="hover:text-ink transition-colors">
            الرئيسية
          </Link>
        </li>
        <li>
          <Icon name="chevron-forward" size={12} strokeWidth={2} className="opacity-60" />
        </li>
        <li>
          <Link href={routes.products} className="hover:text-ink transition-colors">
            العناية بالبشرة
          </Link>
        </li>
        <li>
          <Icon name="chevron-forward" size={12} strokeWidth={2} className="opacity-60" />
        </li>
        <li>
          <Link href={routes.products} className="hover:text-ink transition-colors">
            سيروم ونضارة
          </Link>
        </li>
        <li>
          <Icon name="chevron-forward" size={12} strokeWidth={2} className="opacity-60" />
        </li>
        <li aria-current="page" className="font-bold text-ink">
          {name}
        </li>
      </ol>
    </nav>
  );
}

/**
 * Image Gallery with interactive thumbnails, zoom dialog, wishlist toggle, and slide badges.
 */
function Gallery({ variant, name }: { variant: PublicVariant; name: string }) {
  const { withAuth } = useAuth();
  const images = variant.media.length
    ? variant.media
    : MOCK_STARVILLE_PRODUCT.media;

  const [activeIndex, setActiveIndex] = useState(0);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [liked, setLiked] = useState(false);

  const thumbnailLabels = [
    'العبوة الأساسية',
    'القوام والامتصاص',
    'قبل وبعد',
    'طريقة الاستخدام',
  ];

  const currentImage = images[activeIndex] || images[0];

  return (
    <div className="flex flex-col gap-3.5">
      {/* Main Image Box */}
      <div className="relative aspect-square w-full overflow-hidden rounded-image bg-linen shadow-outline-hairline group">
        <Image
          src={currentImage.url}
          alt={currentImage.altText || name}
          fill
          priority
          sizes="(min-width: 1024px) 520px, 100vw"
          className="object-contain p-6 transition-transform duration-500 ease-out group-hover:scale-105"
        />

        {/* Top Badges */}
        <div className="pointer-events-none absolute inset-x-3.5 top-3.5 flex items-center justify-between">
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 rounded-pill bg-citron px-3 py-1 text-12 font-bold text-ink shadow-elevation-1">
              <Icon name="sparkles" size={13} strokeWidth={2} />
              الأكثر مبيعاً
            </span>
            <span className="flex items-center gap-1.5 rounded-pill bg-chalk/90 px-3 py-0.5 text-11.5 font-bold text-ok backdrop-blur-sm shadow-elevation-1">
              <span className="size-2 rounded-pill bg-ok" />
              بشهد من أطباء الجلدية
            </span>
          </div>

          <button
            type="button"
            aria-label="أضف للمفضلة"
            onClick={() => {
              withAuth(
                () => {
                  setLiked(!liked);
                },
                {
                  title: 'أضف إلى قائمة الرغبات',
                  description:
                    'سجّل دخولك لحفظ منتجاتك المفضلة والوصول إليها لاحقاً.',
                  intent: 'wishlist',
                }
              );
            }}
            className={cn(
              'pointer-events-auto flex size-10 items-center justify-center rounded-pill bg-chalk/90 backdrop-blur-sm shadow-elevation-1 transition-all duration-300 active:scale-90 hover:scale-110',
              liked ? 'text-tomato-ink' : 'text-stone hover:text-ink'
            )}
          >
            <Icon
              name="heart"
              size={20}
              strokeWidth={2}
              fill={liked ? 'currentColor' : 'none'}
            />
          </button>
        </div>

        {/* Bottom Bar: Counter and Zoom */}
        <div className="absolute inset-x-3.5 bottom-3.5 flex items-center justify-between">
          <span className="flex items-center gap-1 rounded-pill bg-ink/80 px-2.5 py-1 text-12 font-bold text-chalk backdrop-blur-sm">
            <span>{activeIndex + 1}</span>
            <span>/</span>
            <span>{images.length}</span>
          </span>

          <button
            type="button"
            aria-label="تكبير الصورة"
            onClick={() => setZoomOpen(true)}
            className="flex size-9 items-center justify-center rounded-pill bg-chalk/90 text-ink backdrop-blur-sm shadow-elevation-1 transition-transform hover:scale-105"
          >
            <Icon name="expand" size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Thumbnails Row */}
      <div className="grid grid-cols-4 gap-2">
        {images.map((img, idx) => (
          <button
            key={img.id || idx}
            type="button"
            onClick={() => setActiveIndex(idx)}
            className={cn(
              'flex flex-col items-center gap-1 rounded-card bg-linen p-1.5 transition-all duration-200 focus-visible:outline-none',
              idx === activeIndex
                ? 'ring-2 ring-cobalt shadow-elevation-1 scale-102 bg-chalk'
                : 'shadow-outline-hairline opacity-75 hover:opacity-100 hover:bg-chalk'
            )}
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-image">
              <Image
                src={img.url}
                alt={img.altText || `صورة ${idx + 1}`}
                fill
                sizes="80px"
                className="object-contain p-1"
              />
            </div>
            <span className="line-clamp-1 text-10.5 font-bold text-stone">
              {thumbnailLabels[idx] || `صورة ${idx + 1}`}
            </span>
          </button>
        ))}
      </div>

      {/* Zoom Dialog */}
      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent closeLabel="إغلاق" className="max-w-lg p-4">
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <div className="relative aspect-square w-full overflow-hidden rounded-image bg-chalk">
            <Image
              src={currentImage.url}
              alt={currentImage.altText || name}
              fill
              sizes="600px"
              className="object-contain p-4"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Product Identity: Brand, Availability, Title, Subtitle, Tags, and Rating.
 */
function Identity({
  product,
  name,
}: {
  product: ProductDetail;
  name: string;
}) {
  const brandName = product.brand.name;
  const subtitle =
    'للتحكم في الدهون وتقليل مظهر المسام وتوحيد لون البشرة بفاعلية طبية متوازنة';

  const tags = [
    { label: 'سيروم مركز', primary: true },
    { label: 'للبشرة الدهنية والمختلطة', primary: false },
    { label: 'المسام', primary: false },
    { label: 'حب الشباب', primary: false },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      {/* Brand & Stock Status */}
      <div className="flex items-center justify-between">
        <span className="font-serif text-24 italic text-cobalt">
          {brandName}
        </span>

        <span className="flex items-center gap-1.5 rounded-pill bg-ok-tint px-3 py-1 text-12 font-bold text-ok">
          <span className="size-2 rounded-pill bg-ok animate-pulse" />
          متوفر بالمخزون
        </span>
      </div>

      {/* Title */}
      <h1
        id="pdp-title"
        className="m-0 font-display text-30 font-bold leading-36 text-ink lg:text-40 lg:leading-45"
      >
        {name}
      </h1>

      {/* Subtitle */}
      <p className="m-0 text-14.5 leading-24 text-stone lg:text-15">
        {subtitle}
      </p>

      {/* Tags Row */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {tags.map((tag, idx) => (
          <span
            key={idx}
            className={cn(
              'rounded-pill px-3 py-1 text-12 font-bold transition-transform hover:scale-105',
              tag.primary
                ? 'bg-cobalt text-chalk shadow-elevation-1'
                : 'bg-sand/70 text-ink shadow-outline-hairline'
            )}
          >
            {tag.label}
          </span>
        ))}
      </div>

      {/* Rating Line */}
      <div className="pt-1">
        <HeroRating slug={product.slug} />
      </div>
    </div>
  );
}

/**
 * Price Row: Displaying price, compareAt strike-through, and savings chip.
 */
function PriceRow({
  variant,
  quantity,
}: {
  variant: PublicVariant;
  quantity: number;
}) {
  const locale = useLocale();
  const price = variant.price?.amount || 450;
  const compareAt = variant.price?.compareAtAmount || 520;
  const hasDiscount = compareAt > price;
  const discountPct = Math.round(((compareAt - price) / compareAt) * 100);

  return (
    <div className="flex flex-col gap-1 border-y border-ink/5 py-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-display text-40 font-bold leading-45 text-ink">
          {formatAmount(price * quantity, locale)}{' '}
          <span className="text-16 font-medium text-stone">ج.م</span>
        </span>

        {hasDiscount ? (
          <span className="text-16 text-stone line-through">
            {formatAmount(compareAt * quantity, locale)} ج.م
          </span>
        ) : null}

        {hasDiscount ? (
          <span className="rounded-pill bg-tomato/10 px-2.5 py-0.5 text-12 font-bold text-tomato-ink">
            وفر {discountPct}%
          </span>
        ) : null}
      </div>

      {quantity > 1 ? (
        <span className="text-12 text-stone">
          سعر القطعة الواحدة: {formatAmount(price, locale)} ج.م
        </span>
      ) : null}
    </div>
  );
}

/**
 * Size Selection: 50ml (with "الأكثر طلباً") vs 30ml radio choices.
 */
function SizeOptions({
  product,
  selectedId,
  onSelect,
}: {
  product: ProductDetail;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const skus = product.skus.length ? product.skus : MOCK_STARVILLE_PRODUCT.skus;

  return (
    <div className="flex flex-col gap-2">
      <label className="text-14 font-bold text-ink">الحجم:</label>
      <div className="grid grid-cols-2 gap-2.5">
        {skus.map((sku) => {
          const isSelected = sku.id === selectedId;
          const isPopular = sku.size === 50;
          return (
            <button
              key={sku.id}
              type="button"
              onClick={() => onSelect(sku.id)}
              className={cn(
                'relative flex items-center justify-between rounded-card p-3.5 text-start transition-all duration-200 focus-visible:outline-none',
                isSelected
                  ? 'bg-cobalt text-chalk shadow-elevation-2 ring-2 ring-cobalt'
                  : 'bg-linen text-ink shadow-outline-control hover:bg-chalk'
              )}
            >
              <div className="flex flex-col">
                <span className="text-15 font-bold">{sku.variantName}</span>
                <span
                  className={cn(
                    'text-12.5 font-medium',
                    isSelected ? 'text-chalk/80' : 'text-stone'
                  )}
                >
                  {sku.price?.amount || 450} ج.م
                </span>
              </div>

              {isPopular ? (
                <span
                  className={cn(
                    'rounded-pill px-2 py-0.5 text-10.5 font-bold',
                    isSelected ? 'bg-citron text-ink' : 'bg-sand text-ink'
                  )}
                >
                  الأكثر طلباً
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Buy Actions Row: Quantity stepper, Primary Add to Cart, Buy Now, and Wishlist button.
 */
function BuyRow({
  quantity,
  setQuantity,
  addState,
  onAdd,
}: {
  quantity: number;
  setQuantity: (n: number) => void;
  addState: 'idle' | 'pending' | 'added';
  onAdd: () => void;
}) {
  const locale = useLocale();
  const router = useRouter();
  const [buyingNow, setBuyingNow] = useState(false);

  const handleBuyNow = async () => {
    setBuyingNow(true);
    await onAdd();
    router.push(routes.checkout);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Quantity Stepper */}
        <QuantityStepper
          value={quantity}
          displayValue={formatNumber(quantity, locale)}
          max={10}
          onChange={setQuantity}
          labels={{ group: 'الكمية', decrease: 'تقليل', increase: 'زيادة' }}
          className="h-control-l [&_button]:h-control-l [&_button]:w-11 shadow-outline-control"
        />

        {/* Primary CTA: Add to Cart */}
        <AsyncButton
          state={addState === 'pending' ? 'pending' : 'idle'}
          variant="cobalt"
          size="l"
          className="min-w-0 flex-1 shadow-elevation-1 transition-transform active:scale-98"
          pendingLabel="جاري الإضافة..."
          onClick={onAdd}
        >
          <Icon name={addState === 'added' ? 'check' : 'bag'} size={18} strokeWidth={2.2} />
          {addState === 'added' ? 'تمت الإضافة بنجاح ✓' : 'أضف إلى السلة'}
        </AsyncButton>

        {/* Secondary CTA: Buy Now with lightning bolt */}
        <Button
          variant="ink"
          size="l"
          disabled={buyingNow}
          onClick={handleBuyNow}
          className="flex items-center gap-2 shadow-elevation-1"
        >
          <Icon name="zap" size={17} strokeWidth={2.4} className="text-citron" />
          اشتري الآن
        </Button>
      </div>

      {addState === 'added' ? (
        <Toast action={{ label: 'إلى السلة', onClick: () => router.push(routes.cart) }}>
          <span className="flex items-center gap-2 text-ok font-bold">
            <Icon name="check" size={16} strokeWidth={2.4} />
            تمت إضافة سيروم النياسيناميد إلى سلة مشترياتك
          </span>
        </Toast>
      ) : null}
    </div>
  );
}

/**
 * Delivery & Returns Collapsible Disclosure.
 */
function DeliveryDisclosure() {
  return (
    <details className="group rounded-card bg-linen/60 p-4 shadow-outline-hairline">
      <summary className="flex cursor-pointer list-none items-center justify-between text-ink [&::-webkit-details-marker]:hidden font-semibold text-14">
        <span className="flex items-center gap-2">
          <Icon name="truck" size={18} className="text-cobalt" />
          معلومات التوصيل والاسترجاع
        </span>
        <Icon
          name="chevron-down"
          size={16}
          strokeWidth={2}
          className="transition-transform duration-200 group-open:rotate-180 text-stone"
        />
      </summary>
      <div className="mt-3 flex flex-col gap-1.5 border-t border-ink/5 pt-2.5 text-13 leading-22 text-stone">
        <p className="m-0">
          • توصيل سريع خلال 24 - 48 ساعة داخل القاهرة الكبرى والجيزة، و3 - 4 أيام لباقي المحافظات.
        </p>
        <p className="m-0">
          • إمكانية الدفع عند الاستلام (COD) أو عبر بطاقات الدفع الإلكتروني بأمان تام.
        </p>
        <p className="m-0">
          • استرجاع مجاني وسهل خلال 14 يوماً وفقاً للشروط والأحكام.
        </p>
      </div>
    </details>
  );
}

/**
 * Mobile Sticky Bottom Purchase Bar:
 * Slides up smoothly when the user scrolls past the top buy box.
 */
function MobilePurchaseBar({
  variant,
  quantity,
  setQuantity,
  addState,
  onAdd,
  visible,
}: {
  variant: PublicVariant;
  quantity: number;
  setQuantity: (n: number) => void;
  addState: 'idle' | 'pending' | 'added';
  onAdd: () => void;
  visible: boolean;
}) {
  const locale = useLocale();
  const price = variant.price?.amount || 450;

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-nav flex items-center justify-between gap-3 border-t border-ink/10 bg-chalk/95 p-3.5 backdrop-blur-md transition-transform duration-300 lg:hidden shadow-elevation-3',
        visible ? 'translate-y-0' : 'pointer-events-none translate-y-full'
      )}
      aria-hidden={!visible}
    >
      <div className="flex flex-col">
        <span className="text-11 text-stone">الإجمالي</span>
        <span className="font-display text-18 font-bold text-ink">
          {formatAmount(price * quantity, locale)} ج.م
        </span>
      </div>

      <div className="flex items-center gap-2">
        <QuantityStepper
          value={quantity}
          displayValue={formatNumber(quantity, locale)}
          max={10}
          onChange={setQuantity}
          labels={{ group: 'الكمية', decrease: 'تقليل', increase: 'زيادة' }}
          className="h-10 [&_button]:h-10 [&_button]:w-8 shadow-outline-control"
        />

        <Button
          variant="cobalt"
          size="m"
          onClick={onAdd}
          className="flex items-center gap-2 shadow-elevation-1"
        >
          <Icon name={addState === 'added' ? 'check' : 'bag'} size={16} strokeWidth={2.4} />
          {addState === 'added' ? 'تمت الإضافة ✓' : 'أضف للسلة'}
        </Button>
      </div>
    </div>
  );
}
