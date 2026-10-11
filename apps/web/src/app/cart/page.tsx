'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { useCart } from '@/features/cart/hooks/useCart';
import { ApiError } from '@/lib/api-client';
import { Minus, Plus, Search, Heart, ShoppingCart, Trash2, MapPin, Truck, CheckCircle2, ShieldCheck, ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { BrandLogo } from '@/components/BrandLogo';
import { MobileBottomNav } from '@/features/home/components/MobileBottomNav';
import { useLocale } from '@/lib/i18n/LocaleProvider';

/** Backend limit per cart line (UpdateCartItemQuantityDto @Max(20)). */
const MAX_LINE_QUANTITY = 20;

export default function CartPage() {
  const router = useRouter();
  const m = useMessages();
  const locale = useLocale();
  const { cart, isLoading, error, updateItem, removeItem, invalidate } = useCart();
  const [actionError, setActionError] = useState('');
  // Mutation failures (stale cart, quantity limit, expired session) must be shown, not swallowed.
  const run = (action: Promise<unknown>) => {
    setActionError('');
    action.catch((err: unknown) => setActionError(err instanceof Error ? err.message : m.unexpectedError));
  };
  const isRtl = locale === 'ar';
  const ArrowIcon = isRtl ? ArrowLeft : ArrowRight;

  // No cart object and no error yet also means "not loaded" (e.g. a paused retry), never "empty".
  if (isLoading || (!cart && !error)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh]">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="mt-4 text-muted-foreground">{m.loading}</p>
      </div>
    );
  }

  // A failed load is not an empty cart: show the error and a retry.
  if (error && !cart) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <div role="alert" className="mx-auto mt-24 max-w-md px-4 text-center">
          <h2 className="mb-2 text-h3 text-foreground">{m.unexpectedError}</h2>
          <p className="mb-6 text-support text-muted-foreground">{error instanceof ApiError ? error.message : m.unexpectedErrorDescription}</p>
          <button
            onClick={invalidate}
            className="h-11 rounded-md bg-primary px-6 font-medium text-primary-foreground hover:bg-primary-hover"
          >
            {m.tryAgain}
          </button>
        </div>
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="min-h-screen bg-background pb-24">
        {/* Custom Header */}
        <header className="flex justify-between items-center py-4 px-4 bg-transparent" dir="ltr">
          <BrandLogo />
          <div className="flex gap-4 items-center">
            <Search className="w-6 h-6 text-foreground" />
            <Heart className="w-6 h-6 text-foreground" />
            <div className="relative">
              <ShoppingCart className="w-6 h-6 text-foreground" />
            </div>
          </div>
        </header>
        
        <div className="text-center py-24 max-w-md mx-auto px-4">
          <div className="text-5xl mb-4">🛒</div>
          <h2 className="text-2xl font-serif text-foreground mb-2">
            {m.cartEmpty}
          </h2>
          <button 
            onClick={() => router.push('/products')} 
            className="w-full mt-8 bg-primary hover:bg-primary-hover text-primary-foreground font-medium py-4 rounded-xl transition-colors"
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
    <div className="min-h-screen bg-background pb-32 lg:pb-12">
      {/* Custom Header for Mobile (matching screenshot) */}
      <header className="flex justify-between items-center py-4 px-4 bg-transparent lg:hidden" dir="ltr">
        <BrandLogo />
        <div className="flex gap-4 items-center">
          <Search className="w-6 h-6 text-foreground" />
          <Heart className="w-6 h-6 text-foreground" />
          <div className="relative">
            <ShoppingCart className="w-6 h-6 text-foreground" />
            <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] w-4 h-4 flex items-center justify-center rounded-full">
              {cart.itemCount}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 pt-2 lg:py-12">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-1">{m.cartTitle}</h1>
          <p className="text-muted-foreground text-sm">{m.cartSubtitle}</p>
        </div>

        {(error || actionError) && (
          <div role="alert" className="bg-destructive-subtle text-destructive p-4 rounded-xl mb-6 font-medium text-sm">
            {actionError || error?.message || m.unexpectedError}
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          
          {/* Left Column: Items */}
          <div className="flex-1 w-full flex flex-col gap-6">
            
            {/* Items Section */}
            <section>
              <h2 className="text-base font-bold text-foreground mb-3">
                {m.cartOtherItems.replace('{count}', cart.itemCount.toString())}
              </h2>
              
              <div className="flex flex-col gap-4">
                {cartItems.map((item) => (
                  <div key={item.skuId} className="bg-card p-4 rounded-2xl shadow-sm border border-black/5 relative">
                    
                    {/* Top right actions (in RTL, it's top left) */}
                    <div className="absolute top-4 rtl:left-4 ltr:right-4 flex items-center gap-3">
                      <button 
                        onClick={() => run(removeItem(item.skuId))}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={m.removeItem}
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="flex gap-4">
                      {/* Product Image */}
                      <div className="w-20 h-24 bg-secondary rounded-lg shrink-0 flex items-center justify-center text-xl overflow-hidden relative">
                        {/* Placeholder for real image */}
                        <span className="opacity-30">📦</span>
                        {/* Fake routine tag if needed, but omitted per instructions */}
                      </div>

                      {/* Product Details */}
                      <div className="flex-1 flex flex-col pt-1">
                        <div className="pr-2 rtl:pl-10 ltr:pr-10">
                          {item.sku.product.brand.name ? <div className="text-xs font-bold text-foreground">{item.sku.product.brand.name}</div> : null}
                          <Link href={`/products/${item.sku.product.slug}`} className="text-sm font-medium text-foreground leading-tight block mt-0.5 mb-1 hover:underline">
                            {item.sku.product.name || m.unavailable}
                          </Link>
                          <div className="text-xs text-muted-foreground mb-2">
                            {item.sku.size ? `${item.sku.size}${item.sku.sizeUnit}` : item.sku.variantName}
                          </div>

                          {/* Availability Badge */}
                          {item.canOrder ? (
                            <div className="inline-flex items-center gap-1 bg-success-subtle text-success px-2 py-0.5 rounded text-[10px] font-medium mb-3">
                              <CheckCircle2 className="w-3 h-3" />
                              {m.cartAvailableToOrder}
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-1 bg-warning-subtle text-warning px-2 py-0.5 rounded text-[10px] font-medium mb-3">
                              {m.unavailable}
                            </div>
                          )}
                        </div>

                        {/* Price and Quantity */}
                        <div className="flex justify-between items-center mt-auto">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-base text-foreground">
                              {item.price ? `${item.price.amount} ج.م` : null}
                            </span>
                            {/* If backend gave a discount, we would show it here. Mocked for screenshot fidelity but removed hardcoding. */}
                          </div>

                          <div className="flex items-center border border-border rounded-lg h-8 bg-card">
                            <button 
                              onClick={() => run(updateItem({ skuId: item.skuId, quantity: item.quantity + 1 }))}
                              disabled={item.quantity >= MAX_LINE_QUANTITY}
                              aria-label={m.increaseQuantity}
                              className="w-8 h-full flex items-center justify-center text-muted-foreground hover:text-foreground disabled:text-disabled-foreground"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <span className="text-sm font-medium w-6 text-center text-foreground">
                              {item.quantity}
                            </span>
                            <button 
                              onClick={() => {
                                if (item.quantity > 1) run(updateItem({ skuId: item.skuId, quantity: item.quantity - 1 }));
                              }}
                              disabled={item.quantity <= 1}
                              aria-label={m.decreaseQuantity}
                              className="w-8 h-full flex items-center justify-center text-muted-foreground hover:text-foreground disabled:text-disabled-foreground"
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
            <section className="bg-card p-5 rounded-2xl shadow-sm border border-black/5 mt-2">
              <div className="flex items-center gap-2 mb-4">
                <Truck className="w-5 h-5 text-foreground" />
                <h3 className="font-bold text-foreground">{m.availabilityAndDelivery}</h3>
              </div>
              
              <div className="bg-success-subtle p-4 rounded-xl flex items-start gap-3 mb-4">
                <div className="mt-0.5 bg-success text-success-foreground rounded-full p-0.5">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-success text-sm mb-1">{m.cartAvailableToOrder}</div>
                  <div className="text-xs text-success leading-relaxed">
                    {m.cartAvailabilityDesc}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border border-border rounded-xl p-3">
                <div className="flex items-center gap-3">
                  <div className="bg-muted p-2 rounded-full">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-foreground">{m.deliveryTo}</div>
                    <div className="text-xs text-muted-foreground">{m.deliveryTime}</div>
                  </div>
                </div>
                <ArrowIcon className="w-4 h-4 text-muted-foreground" />
              </div>
            </section>
          </div>

          {/* Right Column: Sticky Summary */}
          <div className="w-full lg:w-[380px] bg-card p-5 rounded-2xl shadow-sm border border-black/5 lg:sticky lg:top-8 mt-2 lg:mt-0 mb-6 lg:mb-0">
            <div className="flex items-center gap-2 mb-5">
              <ShoppingCart className="w-5 h-5 text-foreground" />
              <h2 className="text-base font-bold text-foreground">{m.orderSummary}</h2>
            </div>
            
            <div className="flex flex-col gap-3 mb-4 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>{m.productsCount.replace('{count}', cart.itemCount.toString())}</span>
                <span className="font-medium text-foreground">{cart.total.toFixed(0)} ج.م</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{m.deliveryTo}</span>
                <span className="font-medium text-success">{m.freeShipping}</span>
              </div>
            </div>

            {/* Free shipping banner */}
            <div className="bg-success-subtle text-success text-xs font-bold p-3 rounded-lg flex items-center justify-center gap-1.5 mb-5">
              <span className="text-lg leading-none mb-0.5">✨</span> {m.congratsFreeShipping}
            </div>

            <div className="flex justify-between items-center mb-6">
              <span className="font-bold text-lg text-foreground">{m.total}</span>
              <span className="font-bold text-2xl text-foreground">{cart.total.toFixed(0)} ج.م</span>
            </div>

            {/* Desktop CTA (hidden on mobile, sticky on mobile) */}
            <div className="hidden lg:block">
              <button 
                onClick={() => router.push('/checkout')} 
                className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold py-4 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {m.checkoutSecurely}
                <ArrowIcon className="w-5 h-5" />
              </button>
              <div className="flex justify-center items-center gap-1.5 mt-4 text-xs text-muted-foreground">
                <ShieldCheck className="w-4 h-4" />
                <span>{m.securePaymentDesc}</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Sticky CTA */}
      <div className="lg:hidden fixed bottom-[60px] left-0 right-0 p-4 bg-card/95 backdrop-blur border-t border-border z-40 pb-6">
        <button 
          onClick={() => router.push('/checkout')} 
          className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
        >
          {m.checkoutSecurely}
          <ArrowIcon className="w-5 h-5" />
        </button>
        <div className="flex justify-center items-center gap-1.5 mt-2.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{m.securePaymentDesc}</span>
        </div>
      </div>

      <MobileBottomNav />
    </div>
  );
}
