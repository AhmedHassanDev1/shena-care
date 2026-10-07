'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ProductView } from '../types/catalog.types';
import { cart } from '@/lib/cart';
import { auth } from '@/lib/auth';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { formatCurrency, formatNumber } from '@/lib/i18n/format';
import { routes } from '@/lib/routes';
import { 
  ChevronLeft, Search, Heart, ShoppingBag, 
  CheckCircle2, Star, Minus, Plus, 
  ChevronRight, Info, Truck, ShieldCheck, 
  Sun, Sparkles, RefreshCcw, Share2
} from 'lucide-react';
import Link from 'next/link';

interface ProductDetailProps {
  product: ProductView;
}

export function ProductDetail({ product }: ProductDetailProps) {
  const router = useRouter();
  const locale = useLocale();
  const m = useMessages();
  
  const [selectedSkuId, setSelectedSkuId] = useState<string>(product.skus[0]?.id || '');
  const [quantity, setQuantity] = useState(1);
  const [addingToCart, setAddingToCart] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showStickyBar, setShowStickyBar] = useState(false);

  const selectedSku = product.skus.find(s => s.id === selectedSkuId) || product.skus[0];
  const isRtl = locale === 'ar';
  const ltrIconClass = isRtl ? 'rotate-180' : '';

  useEffect(() => {
    const handleScroll = () => {
      setShowStickyBar(window.scrollY > 500);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleAddToCart = async (skuId: string) => {
    if (!auth.isAuthenticated()) {
      router.push(routes.login);
      return;
    }

    setAddingToCart(true);
    setMessage(null);

    try {
      await cart.addToCart(skuId, quantity);
      setMessage({ type: 'success', text: m.addedToCart });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      if (err instanceof Error && 'status' in err && (err as { status: number }).status === 401) {
        router.push(routes.login);
      } else {
        setMessage({ type: 'error', text: m.addToCartFailed });
      }
    } finally {
      setAddingToCart(false);
    }
  };

  return (
    <div className="bg-norya-canvas min-h-screen text-norya-stone-900 pb-24">
      {/* Top Navigation - Optional for standalone page, but matches UI */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-norya-border-subtle px-4 h-14 flex items-center justify-between lg:hidden">
        <button onClick={() => router.back()} className="p-2 -ml-2 text-norya-stone-900">
          <ChevronLeft className={`w-6 h-6 ${ltrIconClass}`} />
        </button>
        <div className="flex-1 px-4">
          <div className="bg-norya-muted h-9 rounded-full flex items-center px-3 gap-2 text-norya-stone-400">
            <Search className="w-4 h-4" />
            <span className="text-sm truncate">Search products, concerns...</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-2 text-norya-stone-900"><Heart className="w-6 h-6" /></button>
          <button className="p-2 text-norya-stone-900 relative">
            <ShoppingBag className="w-6 h-6" />
            {/* Hardcoded badge for UI fidelity with screenshot, ideally dynamic */}
            <span className="absolute top-1.5 right-1 w-4 h-4 bg-norya-primary text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
              3
            </span>
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row lg:gap-12 lg:p-8">
        {/* LEFT COLUMN: Media Gallery */}
        <div className="w-full lg:w-[45%] lg:sticky lg:top-8 lg:h-max">
          <div className="relative w-full aspect-[4/5] lg:aspect-square bg-[#F5EBE6] lg:rounded-2xl overflow-hidden mb-3">
            {product.media.length > 0 ? (
              <>
                <img
                  src={product.media[currentImageIndex]?.url}
                  alt={product.media[currentImageIndex]?.altText || product.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-4 right-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-norya-stone-900 shadow-sm" dir="ltr">
                  {currentImageIndex + 1} / {product.media.length}
                </div>
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-norya-stone-400">
                {m.noImageAvailable}
              </div>
            )}
            
            <div className="absolute top-4 left-4 flex flex-col gap-2">
              <div className="flex flex-col items-center justify-center bg-white/95 rounded-xl p-2 w-[60px] h-[72px] shadow-sm">
                <ShieldCheck className="w-6 h-6 text-norya-primary mb-1" strokeWidth={1.5} />
                <span className="text-[9px] leading-tight text-center font-medium text-norya-stone-900">Official<br/>Product</span>
              </div>
              <div className="flex flex-col items-center justify-center bg-white/95 rounded-xl p-2 w-[60px] h-[72px] shadow-sm">
                <ShoppingBag className="w-6 h-6 text-norya-primary mb-1" strokeWidth={1.5} />
                <span className="text-[9px] leading-tight text-center font-medium text-norya-stone-900">Exact<br/>Packshot</span>
              </div>
              <div className="flex flex-col items-center justify-center bg-white/95 rounded-xl p-2 w-[60px] h-[72px] shadow-sm">
                <CheckCircle2 className="w-6 h-6 text-norya-primary mb-1" strokeWidth={1.5} />
                <span className="text-[9px] leading-tight text-center font-medium text-norya-stone-900">Verified<br/>Brand</span>
              </div>
            </div>
            
            <div className="absolute top-4 right-4 hidden lg:flex flex-col gap-2">
              <button className="w-10 h-10 bg-white/90 backdrop-blur rounded-full flex items-center justify-center shadow-sm text-norya-stone-900 hover:text-norya-primary transition-colors">
                <Heart className="w-5 h-5" />
              </button>
              <button className="w-10 h-10 bg-white/90 backdrop-blur rounded-full flex items-center justify-center shadow-sm text-norya-stone-900 hover:text-norya-primary transition-colors">
                 <Share2 className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Thumbnails */}
          {product.media.length > 1 && (
            <div className="flex gap-2 px-4 lg:px-0 overflow-x-auto pb-4 hide-scrollbar">
              {product.media.map((media, idx) => (
                <button
                  key={media.id}
                  onClick={() => setCurrentImageIndex(idx)}
                  className={`flex-shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-xl overflow-hidden border-2 transition-all ${
                    idx === currentImageIndex ? 'border-norya-primary opacity-100' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  <img src={media.url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Product Information */}
        <div className="w-full lg:w-[55%] px-4 lg:px-0 flex flex-col pt-2 pb-8">
          
          <Link href={`/brands/${product.brand.slug}`} className="flex items-center gap-2 text-xs font-bold tracking-wider text-[#00529B] uppercase mb-3 hover:opacity-80">
            {/* The brand logo placeholder */}
            <div className="w-4 h-4 bg-[#00529B]" /> 
            {product.brand.name} 
            <ChevronRight className={`w-4 h-4 ${ltrIconClass}`} />
          </Link>
          
          <h1 className="text-3xl font-serif text-norya-stone-900 mb-3 tracking-tight">
            {product.name}
          </h1>
          
          {product.description && (
            <p className="text-[15px] text-norya-stone-600 mb-4 leading-relaxed">
              {product.description}
            </p>
          )}

          {/* Rating (Empty State fallback based on instructions) */}
          <div className="flex items-center gap-1.5 mb-5 cursor-pointer">
            <Star className="w-4 h-4 text-norya-gold fill-norya-gold" />
            <span className="text-[15px] font-bold text-norya-stone-900">{formatNumber(0, locale)}</span>
            <span className="text-[15px] text-norya-stone-400">({m.reviewsEmpty})</span>
            <ChevronRight className={`w-4 h-4 text-norya-stone-400 ${ltrIconClass}`} />
          </div>

          {/* Sizes / Variants */}
          {product.skus.length > 0 && (
            <div className="mb-6">
              <div className="text-sm font-bold text-norya-stone-900 mb-3">{m.size}</div>
              <div className="flex flex-wrap gap-2">
                {product.skus.map(sku => (
                  <button
                    key={sku.id}
                    onClick={() => setSelectedSkuId(sku.id)}
                    className={`px-7 py-2.5 rounded-xl border text-sm font-bold transition-all ${
                      selectedSkuId === sku.id
                        ? 'border-norya-primary text-norya-primary bg-norya-primary-light/40 shadow-sm'
                        : 'border-norya-border-subtle text-norya-stone-600 bg-white hover:border-norya-primary/40'
                    }`}
                  >
                    {sku.size ? `${formatNumber(Number(sku.size), locale)}${sku.sizeUnit}` : sku.variantName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Price & Add to Cart (Desktop & Mobile Main) */}
          <div className="flex flex-col gap-4 mb-8">
            {selectedSku?.price && (
              <div className="text-[28px] font-bold text-norya-stone-900 tracking-tight">
                {formatCurrency(selectedSku.price.amount, selectedSku.price.currency, locale)}
              </div>
            )}
            
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-between border border-norya-border rounded-xl px-4 py-3.5 bg-white w-32 shadow-sm">
                <button 
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="text-norya-stone-400 hover:text-norya-stone-900 transition-colors focus:outline-none"
                >
                  <Minus className="w-5 h-5" />
                </button>
                <span className="font-bold text-norya-stone-900 text-lg">{formatNumber(quantity, locale)}</span>
                <button 
                  onClick={() => setQuantity(quantity + 1)}
                  className="text-norya-stone-400 hover:text-norya-stone-900 transition-colors focus:outline-none"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <button
                onClick={() => handleAddToCart(selectedSku.id)}
                disabled={addingToCart || !selectedSku?.canOrder}
                className="flex-1 bg-norya-primary hover:bg-norya-primary-hover text-white py-3.5 px-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
              >
                <ShoppingBag className="w-5 h-5" />
                {addingToCart ? m.adding : selectedSku?.canOrder ? m.addToCart : m.unavailable}
              </button>
            </div>
            
            {message && (
              <div className={`text-sm font-medium px-4 py-2 rounded-lg ${message.type === 'success' ? 'bg-[#E8F5E9] text-[#2E7D32]' : 'bg-[#FFEBEE] text-[#C62828]'}`}>
                {message.text}
              </div>
            )}
          </div>

          {/* Availability & Delivery Card */}
          <div className="bg-white rounded-2xl p-4 md:p-5 border border-norya-border-subtle mb-6 shadow-sm flex flex-col gap-5">
            <div className="flex gap-3 items-start">
              <div className="w-6 h-6 rounded-full bg-[#E8F5E9] flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="w-4 h-4 text-[#2E7D32]" />
              </div>
              <div>
                <div className="font-bold text-[#2E7D32] flex items-center gap-1.5">
                  {m.availabilityConfirmation}
                  <Info className="w-4 h-4 text-norya-stone-400" />
                </div>
                <p className="text-[13px] text-norya-stone-600 mt-1 leading-relaxed">
                  {m.availabilityExplanation}
                </p>
              </div>
            </div>
            
            <div className="h-px bg-norya-border-subtle w-full" />
            
            <div className="flex gap-3 items-start">
              <Truck className="w-5 h-5 text-norya-stone-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-norya-stone-900">{m.trustDelivery}</div>
                <p className="text-[13px] text-norya-stone-600 mt-1">
                  Usually 1-2 days after availability confirmation.
                </p>
              </div>
            </div>
          </div>

          {/* Horizontal Trust Strip */}
          <div className="flex justify-between items-center bg-white rounded-2xl px-4 py-4 border border-norya-border-subtle mb-8 shadow-sm">
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <ShieldCheck className="w-6 h-6 text-norya-primary" strokeWidth={1.5} />
              <span className="text-xs font-medium text-norya-stone-600 text-center">{m.trustOriginal}</span>
            </div>
            <div className="h-10 w-px bg-norya-border-subtle" />
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <Truck className="w-6 h-6 text-norya-primary" strokeWidth={1.5} />
              <span className="text-xs font-medium text-norya-stone-600 text-center">{m.trustDelivery}</span>
            </div>
            <div className="h-10 w-px bg-norya-border-subtle" />
            <div className="flex flex-col items-center gap-1.5 flex-1">
              <RefreshCcw className="w-6 h-6 text-norya-primary" strokeWidth={1.5} />
              <span className="text-xs font-medium text-norya-stone-600 text-center">{m.trustReturns}</span>
            </div>
          </div>

          {/* Routine Fit */}
          {product.routineStep && (
            <div className="bg-[#FEF5F4] rounded-2xl p-5 mb-4 border border-[#FEECE9] cursor-pointer hover:bg-[#FDF0EE] transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex gap-3.5">
                  <div className="mt-1 text-norya-primary">
                    <Sun className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-norya-stone-900 mb-1">{m.routineFit}</h3>
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <span className="text-norya-stone-900 font-medium text-sm">
                        {m.routineStep} {formatNumber(product.routineStep, locale)} · {product.category && typeof product.category !== 'string' ? product.category.name : 'Treat'}
                      </span>
                      <span className="text-[11px] font-medium bg-[#FEECE9] text-norya-primary px-2 py-0.5 rounded-sm">
                        {m.morningAndEvening}
                      </span>
                    </div>
                  </div>
                </div>
                <ChevronRight className={`w-5 h-5 text-norya-primary ${ltrIconClass}`} />
              </div>
              {product.usage && (
                <p className="text-[13px] text-norya-stone-600 mt-4 pt-4 border-t border-[#FEECE9] leading-relaxed">
                  {product.usage}
                </p>
              )}
            </div>
          )}

          {/* Beauty Assistant CTA */}
          <div className="bg-[#F0F7FF] rounded-2xl p-5 flex items-center justify-between mb-8 cursor-pointer hover:bg-[#E6F3FF] transition-colors border border-[#E6F3FF]">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-[#0066CC]" />
              <div>
                <div className="font-bold text-[#004C99]">{m.assistantQuestion}</div>
                <div className="text-[13px] text-[#0066CC] mt-0.5">{m.assistantCta}</div>
              </div>
            </div>
            <ChevronRight className={`w-5 h-5 text-[#0066CC] ${ltrIconClass}`} />
          </div>

          {/* Accordion Sections */}
          <div className="bg-white rounded-2xl border border-norya-border-subtle shadow-sm overflow-hidden flex flex-col">
            
            {/* How to use */}
            {product.usage && (
              <div className="p-5 border-b border-norya-border-subtle">
                <div className="flex items-center justify-between font-bold text-lg text-norya-stone-900 mb-4">
                  {m.howToUse}
                  <ChevronRight className={`w-5 h-5 text-norya-stone-400 ${ltrIconClass}`} />
                </div>
                {/* Visual translation of screenshot steps based on product.usage */}
                <div className="flex flex-col gap-4">
                  <div className="flex gap-4">
                     <div className="w-6 h-6 rounded-full bg-norya-primary-light text-norya-primary flex items-center justify-center font-bold text-xs shrink-0">{formatNumber(1, locale)}</div>
                     <div>
                       <div className="font-bold text-norya-stone-900 text-sm">{m.howToUse}</div>
                       <p className="text-sm text-norya-stone-600 leading-relaxed mt-1">{product.usage}</p>
                     </div>
                  </div>
                </div>
              </div>
            )}

            {/* Empty Reviews */}
            <div className="p-5">
              <div className="flex items-center justify-between font-bold text-lg text-norya-stone-900 mb-2 cursor-pointer">
                {m.reviewsTitle}
                <ChevronRight className={`w-5 h-5 text-norya-stone-400 ${ltrIconClass}`} />
              </div>
              <p className="text-sm text-norya-stone-400">{m.reviewsEmpty}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Bottom Bar (Mobile) */}
      <div 
        className={`fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-norya-border-subtle p-4 lg:hidden flex items-center justify-between gap-4 transition-transform duration-300 z-50 ${
          showStickyBar ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex items-center gap-3 overflow-hidden">
           {product.media[0] && (
             <img src={product.media[0].url} alt="" className="w-10 h-10 rounded-md object-cover border border-norya-border-subtle shrink-0" />
           )}
           <div className="flex flex-col min-w-0">
             <span className="text-xs font-bold truncate">{product.name}</span>
             <span className="text-sm font-bold text-norya-stone-900">
               {selectedSku?.price ? formatCurrency(selectedSku.price.amount, selectedSku.price.currency, locale) : ''}
             </span>
           </div>
        </div>
        <button
          onClick={() => handleAddToCart(selectedSku.id)}
          disabled={addingToCart || !selectedSku?.canOrder}
          className="bg-norya-primary hover:bg-norya-primary-hover text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-sm active:scale-[0.98] disabled:opacity-50 whitespace-nowrap shrink-0 transition-colors"
        >
          <ShoppingBag className="w-4 h-4" />
          {addingToCart ? m.adding : selectedSku?.canOrder ? m.addToCart : m.unavailable}
        </button>
      </div>
    </div>
  );
}
