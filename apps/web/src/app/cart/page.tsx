'use client';

import { useRouter } from 'next/navigation';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { useCart } from '@/features/cart/hooks/useCart';
import { Minus, Plus, Search, Heart, ShoppingCart, Trash2, MapPin, Truck, CheckCircle2, ShieldCheck, ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';
import { MobileBottomNav } from '@/features/home/components/MobileBottomNav';
import { useLocale } from '@/lib/i18n/LocaleProvider';

export default function CartPage() {
  const router = useRouter();
  const m = useMessages();
  const locale = useLocale();
  const { cart, isLoading, error, updateItem, removeItem } = useCart();
  const isRtl = locale === 'ar';
  const ArrowIcon = isRtl ? ArrowLeft : ArrowRight;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-10 h-10 border-4 border-[#E57A73] border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-norya-stone-600">{m.loading}</p>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="min-h-screen bg-[#FFFDF9] pb-24">
        {/* Custom Header */}
        <header className="flex justify-between items-center py-4 px-4 bg-transparent" dir="ltr">
          <BrandLogo />
          <div className="flex gap-4 items-center">
            <Search className="w-6 h-6 text-norya-stone-900" />
            <Heart className="w-6 h-6 text-norya-stone-900" />
            <div className="relative">
              <ShoppingCart className="w-6 h-6 text-norya-stone-900" />
            </div>
          </div>
        </header>
        
        <div className="text-center py-24 max-w-md mx-auto px-4">
          <div className="text-5xl mb-4">🛒</div>
          <h2 className="text-2xl font-serif text-norya-stone-900 mb-2">
            {m.cartEmpty}
          </h2>
          <button 
            onClick={() => router.push('/products')} 
            className="w-full mt-8 bg-[#E57A73] hover:bg-[#d66962] text-white font-medium py-4 rounded-xl transition-colors"
          >
            {m.startShopping}
          </button>
        </div>
        <MobileBottomNav />
      </div>
    );
  }

  // Fallback to one normal cart list as requested if no routine context
  const cartItems = cart.items;

  return (
    <div className="min-h-screen bg-[#FFFDF9] pb-32 lg:pb-12">
      {/* Custom Header for Mobile (matching screenshot) */}
      <header className="flex justify-between items-center py-4 px-4 bg-transparent lg:hidden" dir="ltr">
        <BrandLogo />
        <div className="flex gap-4 items-center">
          <Search className="w-6 h-6 text-norya-stone-900" />
          <Heart className="w-6 h-6 text-norya-stone-900" />
          <div className="relative">
            <ShoppingCart className="w-6 h-6 text-norya-stone-900" />
            <span className="absolute -top-1 -right-1 bg-[#E57A73] text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full">
              {cart.itemCount}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 pt-2 lg:py-12">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-norya-stone-900 mb-1">{m.cartTitle}</h1>
          <p className="text-norya-stone-600 text-sm">{m.cartSubtitle}</p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-xl mb-6 font-medium text-sm">
            {error.message || 'Failed to load cart'}
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          
          {/* Left Column: Items */}
          <div className="flex-1 w-full flex flex-col gap-6">
            
            {/* Items Section */}
            <section>
              <h2 className="text-base font-bold text-norya-stone-900 mb-1">
                {m.cartOtherItems.replace('{count}', cart.itemCount.toString())}
              </h2>
              <p className="text-xs text-norya-stone-500 mb-3">منتجات خارج روتينك الحالي.</p>
              
              <div className="flex flex-col gap-4">
                {cartItems.map((item) => (
                  <div key={item.skuId} className="bg-white p-4 rounded-2xl shadow-sm border border-black/5 relative">
                    
                    {/* Top right actions (in RTL, it's top left) */}
                    <div className="absolute top-4 rtl:left-4 ltr:right-4 flex items-center gap-3">
                      <button 
                        onClick={() => updateItem({ skuId: item.skuId, quantity: 0 })} // using updateItem with 0 to remove or removeItem
                        className="text-norya-stone-400 hover:text-red-500 transition-colors"
                        aria-label="Remove item"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="flex gap-4">
                      {/* Product Image */}
                      <div className="w-20 h-24 bg-[#F5F5F5] rounded-lg shrink-0 flex items-center justify-center text-xl overflow-hidden relative">
                        {/* Placeholder for real image */}
                        <span className="opacity-30">📦</span>
                        {/* Fake routine tag if needed, but omitted per instructions */}
                      </div>

                      {/* Product Details */}
                      <div className="flex-1 flex flex-col pt-1">
                        <div className="pr-2 rtl:pl-10 ltr:pr-10">
                          <div className="text-xs font-bold text-norya-stone-900">{item.sku.product.brand?.name || 'Brand'}</div>
                          <Link href={`/products/${item.sku.product.slug}`} className="text-sm font-medium text-norya-stone-800 leading-tight block mt-0.5 mb-1 hover:underline">
                            {item.sku.product.name}
                          </Link>
                          <div className="text-xs text-norya-stone-500 mb-2">
                            {item.sku.size ? `${item.sku.size}${item.sku.sizeUnit}` : item.sku.variantName}
                          </div>

                          {/* Availability Badge */}
                          <div className="inline-flex items-center gap-1 bg-[#E8F5E9] text-[#2E7D32] px-2 py-0.5 rounded text-[10px] font-medium mb-3">
                            <CheckCircle2 className="w-3 h-3" />
                            {m.cartAvailableToOrder}
                          </div>
                        </div>

                        {/* Price and Quantity */}
                        <div className="flex justify-between items-center mt-auto">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-base text-norya-stone-900">
                              {item.price?.amount || item.subtotal} ج.م
                            </span>
                            {/* If backend gave a discount, we would show it here. Mocked for screenshot fidelity but removed hardcoding. */}
                          </div>

                          <div className="flex items-center border border-norya-stone-200 rounded-lg h-8 bg-white">
                            <button 
                              onClick={() => updateItem({ skuId: item.skuId, quantity: item.quantity + 1 })}
                              className="w-8 h-full flex items-center justify-center text-norya-stone-600 hover:text-norya-stone-900"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <span className="text-sm font-medium w-6 text-center text-norya-stone-900">
                              {item.quantity}
                            </span>
                            <button 
                              onClick={() => {
                                if (item.quantity > 1) updateItem({ skuId: item.skuId, quantity: item.quantity - 1 });
                              }}
                              disabled={item.quantity <= 1}
                              className="w-8 h-full flex items-center justify-center text-norya-stone-600 hover:text-norya-stone-900 disabled:opacity-50"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Availability & Delivery Section */}
            <section className="bg-white p-5 rounded-2xl shadow-sm border border-black/5 mt-2">
              <div className="flex items-center gap-2 mb-4">
                <Truck className="w-5 h-5 text-norya-stone-900" />
                <h3 className="font-bold text-norya-stone-900">{m.availabilityAndDelivery}</h3>
              </div>
              
              <div className="bg-[#F0FBEC] p-4 rounded-xl flex items-start gap-3 mb-4">
                <div className="mt-0.5 bg-[#4CAF50] text-white rounded-full p-0.5">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-[#2E7D32] text-sm mb-1">{m.cartAvailableToOrder}</div>
                  <div className="text-xs text-[#2E7D32]/80 leading-relaxed">
                    {m.cartAvailabilityDesc}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border border-norya-stone-200 rounded-xl p-3">
                <div className="flex items-center gap-3">
                  <div className="bg-norya-stone-50 p-2 rounded-full">
                    <MapPin className="w-4 h-4 text-norya-stone-600" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-norya-stone-900">{m.deliveryTo}</div>
                    <div className="text-xs text-norya-stone-500">{m.deliveryTime}</div>
                  </div>
                </div>
                <ArrowIcon className="w-4 h-4 text-norya-stone-400" />
              </div>
            </section>
          </div>

          {/* Right Column: Sticky Summary */}
          <div className="w-full lg:w-[380px] bg-white p-5 rounded-2xl shadow-sm border border-black/5 lg:sticky lg:top-8 mt-2 lg:mt-0 mb-6 lg:mb-0">
            <div className="flex items-center gap-2 mb-5">
              <ShoppingCart className="w-5 h-5 text-norya-stone-900" />
              <h2 className="text-base font-bold text-norya-stone-900">{m.orderSummary}</h2>
            </div>
            
            <div className="flex flex-col gap-3 mb-4 text-sm">
              <div className="flex justify-between text-norya-stone-600">
                <span>{m.productsCount.replace('{count}', cart.itemCount.toString())}</span>
                <span className="font-medium text-norya-stone-900">{cart.total.toFixed(0)} ج.م</span>
              </div>
              <div className="flex justify-between text-norya-stone-600">
                <span>{m.deliveryTo}</span>
                <span className="font-medium text-[#2E7D32]">{m.freeShipping}</span>
              </div>
            </div>

            {/* Free shipping banner */}
            <div className="bg-[#F0FBEC] text-[#2E7D32] text-xs font-bold p-3 rounded-lg flex items-center justify-center gap-1.5 mb-5">
              <span className="text-lg leading-none mb-0.5">✨</span> {m.congratsFreeShipping}
            </div>

            <div className="flex justify-between items-center mb-6">
              <span className="font-bold text-lg text-norya-stone-900">{m.total}</span>
              <span className="font-bold text-2xl text-norya-stone-900">{cart.total.toFixed(0)} ج.م</span>
            </div>

            {/* Desktop CTA (hidden on mobile, sticky on mobile) */}
            <div className="hidden lg:block">
              <button 
                onClick={() => router.push('/checkout')} 
                className="w-full bg-[#E57A73] hover:bg-[#d66962] text-white font-bold py-4 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {m.checkoutSecurely}
                <ArrowIcon className="w-5 h-5" />
              </button>
              <div className="flex justify-center items-center gap-1.5 mt-4 text-xs text-norya-stone-500">
                <ShieldCheck className="w-4 h-4" />
                <span>{m.securePaymentDesc}</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Sticky CTA */}
      <div className="lg:hidden fixed bottom-[60px] left-0 right-0 p-4 bg-white/95 backdrop-blur border-t border-norya-stone-200 z-40 pb-6">
        <button 
          onClick={() => router.push('/checkout')} 
          className="w-full bg-[#E57A73] hover:bg-[#d66962] text-white font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          {m.checkoutSecurely}
          <ArrowIcon className="w-5 h-5" />
        </button>
        <div className="flex justify-center items-center gap-1.5 mt-2.5 text-[11px] text-norya-stone-500">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{m.securePaymentDesc}</span>
        </div>
      </div>

      <MobileBottomNav />
    </div>
  );
}
